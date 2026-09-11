import { Client, type ClientChannel } from 'ssh2'
import { randomBytes } from 'crypto'
import type { SshConnectOptions, RunShellResult } from '../../shared/types'
import { SAFE_ALGORITHMS, SAFE_KEEPALIVE_INTERVAL } from './algorithms'
import { createNoDelaySocket } from './createSocket'
import { foldTerminalOutput } from '../../shared/terminalFold'
import { broadcast } from '../windows'

interface Session {
  client: Client
  channel: ClientChannel | null
}

// Per-session outbound coalescing state. High-frequency producers (e.g. `rsync
// --info=progress2` redraws its line hundreds of times/sec via \r) would otherwise
// emit one IPC message per tiny chunk and freeze the renderer. We batch chunks and
// flush at most once per frame.
interface OutQueue {
  chunks: string[]
  timer: ReturnType<typeof setTimeout> | null
}

// Cap on the per-session replay buffer (chars). Enough to rebuild a few screens of
// scrollback when a tab is torn off into a new window, without unbounded growth.
const REPLAY_CAP = 200_000

// Coalescing window for outbound terminal data (ms). ~one frame at 60fps: keeps
// latency imperceptible while collapsing bursts into a single IPC + xterm write.
const OUTPUT_FLUSH_MS = 16

// 探测终端当前目录的上限:拿不到就退回默认目录,别让 SFTP 面板干等。
const CWD_PROBE_TIMEOUT_MS = 4000

/**
 * 启发式判断输出末尾是否停在一个「等待输入」的提示上(apt 的 [Y/n]、sudo 的 password:、
 * yes/no、以 : ? > 结尾且无换行等)。仅用于给模型一个「疑似等待输入」的提示,不作硬判定。
 */
function looksLikePrompt(output: string): boolean {
  const tail = output.replace(/\s+$/, '').slice(-120)
  if (!tail) return false
  return (
    /\[y\/n\]|\(yes\/no\)|password\s*[:：]|passphrase|口令|密码|continue\?|overwrite\?/i.test(
      tail
    ) || /[:：?？>]$/.test(tail)
  )
}

export class SshManager {
  private sessions = new Map<string, Session>()
  // Rolling tail of each session's output, so a window that adopts the tab can replay
  // the scrollback. Data is broadcast to all windows (channels are keyed by sessionId,
  // so only the window owning the tab listens), which decouples a session from the
  // window it was born in — the prerequisite for moving a tab between windows.
  private buffers = new Map<string, string>()
  private outQueues = new Map<string, OutQueue>()

  private appendBuffer(sessionId: string, chunk: string): void {
    const next = (this.buffers.get(sessionId) ?? '') + chunk
    this.buffers.set(sessionId, next.length > REPLAY_CAP ? next.slice(-REPLAY_CAP) : next)
  }

  // Queue a chunk for the session's terminal and schedule a flush. Batching here means
  // appendBuffer's string concat and the IPC broadcast each run once per frame instead
  // of once per chunk, which is what keeps the UI responsive under high-frequency output.
  private queueOutput(sessionId: string, text: string): void {
    let q = this.outQueues.get(sessionId)
    if (!q) {
      q = { chunks: [], timer: null }
      this.outQueues.set(sessionId, q)
    }
    q.chunks.push(text)
    if (!q.timer) {
      q.timer = setTimeout(() => this.flushOutput(sessionId), OUTPUT_FLUSH_MS)
    }
  }

  private flushOutput(sessionId: string): void {
    const q = this.outQueues.get(sessionId)
    if (!q) return
    q.timer = null
    if (q.chunks.length === 0) return
    const text = q.chunks.join('')
    q.chunks = []
    this.appendBuffer(sessionId, text)
    broadcast(`ssh:data:${sessionId}`, text)
  }

  private disposeOutput(sessionId: string): void {
    const q = this.outQueues.get(sessionId)
    if (!q) return
    if (q.timer) clearTimeout(q.timer)
    // Flush any tail so the last bytes before close aren't dropped.
    if (q.chunks.length > 0) {
      const text = q.chunks.join('')
      q.chunks = []
      this.appendBuffer(sessionId, text)
      broadcast(`ssh:data:${sessionId}`, text)
    }
    this.outQueues.delete(sessionId)
  }

  replay(sessionId: string): string {
    return this.buffers.get(sessionId) ?? ''
  }

  async connect(opts: SshConnectOptions): Promise<void> {
    const sock = await createNoDelaySocket(opts.host, opts.port)

    return new Promise((resolve, reject) => {
      const client = new Client()
      this.sessions.set(opts.sessionId, { client, channel: null })

      // shell 通道与 exec-PTY 通道(容器终端等)共用同一套接线:
      // 数据/关闭事件广播、replay 缓冲、write/resize 都是通道通用的。
      const onChannel = (err: Error | undefined, channel: ClientChannel): void => {
        if (err) {
          reject(err)
          return
        }
        const session = this.sessions.get(opts.sessionId)
        if (session) session.channel = channel

        channel.on('data', (chunk: Buffer) => {
          this.queueOutput(opts.sessionId, chunk.toString('utf8'))
        })
        channel.stderr.on('data', (chunk: Buffer) => {
          this.queueOutput(opts.sessionId, chunk.toString('utf8'))
        })
        channel.on('close', () => {
          this.disposeOutput(opts.sessionId)
          broadcast(`ssh:closed:${opts.sessionId}`)
          // Only remove the map entry if it still points to THIS client — during a
          // reconnect a newer session may already own this id, and we must not delete it.
          if (this.sessions.get(opts.sessionId)?.client === client) {
            this.sessions.delete(opts.sessionId)
          }
          client.end()
        })
        resolve()
      }

      client
        .on('ready', () => {
          if (opts.execCommand) {
            client.exec(opts.execCommand, { pty: { term: 'xterm-256color' } }, onChannel)
          } else {
            client.shell({ term: 'xterm-256color' }, onChannel)
          }
        })
        .on('error', (err) => {
          broadcast(`ssh:error:${opts.sessionId}`, err.message)
          // Only fail the initial connect attempt here; once the shell is up, transport-level
          // warnings (e.g. transient "Bad packet length") must not tear down the live session
          // or writes would silently stop working while the terminal still shows a prompt.
          if (!this.sessions.get(opts.sessionId)?.channel) {
            this.sessions.delete(opts.sessionId)
            reject(err)
          }
        })
        .connect({
          sock,
          username: opts.username,
          password: opts.password,
          privateKey: opts.privateKey,
          passphrase: opts.passphrase,
          readyTimeout: 20000,
          tryKeyboard: true,
          algorithms: SAFE_ALGORITHMS,
          keepaliveInterval: SAFE_KEEPALIVE_INTERVAL
        })

      client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
        if (opts.password && prompts.length > 0) {
          finish([opts.password])
        } else {
          finish([])
        }
      })
    })
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    session?.channel?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    session?.channel?.setWindow(rows, cols, 0, 0)
  }

  exec(sessionId: string, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId)
      if (!session) {
        reject(new Error('SSH session not found'))
        return
      }
      session.client.exec(command, (err, stream) => {
        if (err) {
          reject(err)
          return
        }
        let out = ''
        stream.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8')
        })
        stream.stderr.on('data', () => {
          // monitoring commands ignore stderr noise
        })
        stream.on('close', () => resolve(out))
      })
    })
  }

  /**
   * 主动探针:判断该 channel 此刻是否在提示符、能把输入当命令执行(而不是被某个前台
   * 程序吞掉 stdin)。往通道打一行 printf 唯一 marker,在窗口内收到该 marker 的**输出**
   * 即视为 READY。marker 用 'A''GENT' 拼接,使打印出的文本与输入回显不同,只匹配真输出。
   * 收不到 = 有前台程序(tail/top/vi/read/pager)在吃输入 = NOT READY。
   */
  private probeReady(channel: ClientChannel, timeoutMs = 900): Promise<boolean> {
    return new Promise((resolve) => {
      const marker = randomBytes(4).toString('hex')
      const token = `<<AGENT_RDY:${marker}>>`
      let buf = ''
      let done = false
      const finish = (ok: boolean): void => {
        if (done) return
        done = true
        channel.removeListener('data', onData)
        clearTimeout(timer)
        resolve(ok)
      }
      const onData = (chunk: Buffer): void => {
        buf += chunk.toString('utf8')
        if (buf.includes(token)) finish(true)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      channel.on('data', onData)
      channel.write(`printf '\\n<<A''GENT_RDY:${marker}>>\\n'\n`)
    })
  }

  /**
   * 恢复阶梯:确保 channel 回到可接受输入的提示符。每敲一步就重新探针确认,不是碰运气。
   * Ctrl-C → 再 Ctrl-C → 退分页器(q) → 退 vi(ESC :q!) → Ctrl-Z 挂起并 kill %1。
   * 全部走键盘信号/作业控制,无需猜 PID,也不会误杀无关进程。都不行则判定 stuck。
   */
  private async ensureReady(channel: ClientChannel): Promise<{ ok: boolean; note?: string }> {
    if (await this.probeReady(channel)) return { ok: true }

    const steps: Array<{ send: string; label: string; suspend?: boolean }> = [
      { send: '\x03', label: 'Ctrl-C' },
      { send: '\x03', label: 'Ctrl-C(再次)' },
      { send: 'q\n', label: 'q 退出分页器' },
      { send: '\x1b:q!\r', label: 'ESC :q! 退出编辑器' },
      { send: '\x1a', label: 'Ctrl-Z 挂起', suspend: true }
    ]
    for (const step of steps) {
      channel.write(step.send)
      if (!(await this.probeReady(channel))) continue
      if (step.suspend) {
        // 前台进程被挂到后台作业,清理掉以免遗留
        channel.write('kill -9 %1 2>/dev/null\n')
        await this.probeReady(channel)
      }
      return { ok: true, note: `已用「${step.label}」夺回提示符` }
    }
    return { ok: false, note: '按键与作业控制均无法中断前台进程' }
  }

  /** 从原始缓冲里切出 BEG..END 之间的正文并解析退出码;未完成时给出 BEG 之后的部分输出。 */
  private parseShellOutput(
    raw: string,
    begOut: string,
    endOutPrefix: string
  ): { output: string; exitCode: number | null } {
    const begIdx = raw.indexOf(begOut)
    const endIdx = raw.indexOf(endOutPrefix)
    let output = ''
    let exitCode: number | null = null
    if (begIdx !== -1 && endIdx !== -1 && endIdx > begIdx) {
      output = raw.slice(begIdx + begOut.length, endIdx)
      const rest = raw.slice(endIdx + endOutPrefix.length)
      const m = rest.match(/^(\d+)>>/)
      if (m) exitCode = Number(m[1])
    } else if (begIdx !== -1) {
      // 未收到 END(超时/中断):至少取 BEG 之后已有的部分输出。
      output = raw.slice(begIdx + begOut.length)
    } else {
      output = raw
    }
    // L0:按终端语义折叠刷新帧(\r 覆盖、光标上移重绘),把 docker build 之类的
    // 进度刷屏坍缩回最后一屏,而不是留下几万行几乎相同的帧。
    output = foldTerminalOutput(output).replace(/^\n+/, '').replace(/\n+$/, '')
    return { output, exitCode }
  }

  /**
   * 在会话的对话 shell 里执行一条命令(用户能实时看到、共享 cwd/env),采集其输出与退出码。
   *
   * 完成判定不是固定墙钟超时,而是「空闲超时 + 硬上限」:只要还在出输出(apt 下载、docker
   * build)就一直等到跑完;若静默超过 idleMs 或总时长超过 hardMs,则认为卡住/等待输入,
   * 走 ensureReady 阶梯夺回终端,并把明确状态(completed/interrupted/stuck)回给模型。
   * 执行前也先 ensureReady,保证每条命令都从干净提示符起步,切断「一条卡住后全崩」的连锁。
   */
  async runInShell(
    sessionId: string,
    command: string,
    opts: { idleMs?: number; hardMs?: number } = {}
  ): Promise<RunShellResult> {
    const idleMs = opts.idleMs ?? 12000
    const hardMs = opts.hardMs ?? 180000
    const session = this.sessions.get(sessionId)
    if (!session || !session.channel) {
      throw new Error('终端会话不存在或未就绪')
    }
    const channel = session.channel

    // 0) 执行前先确保终端在提示符——若上一条命令留下了卡死状态,这里先把它恢复掉。
    const pre = await this.ensureReady(channel)
    if (!pre.ok) {
      return {
        output: '',
        exitCode: null,
        timedOut: true,
        state: 'stuck',
        note: `执行前终端就无法接受输入(${pre.note ?? '未知'}),建议断开重连该终端`
      }
    }

    const marker = randomBytes(6).toString('hex')
    const begOut = `<<AGENT_BEG:${marker}>>`
    const endOutPrefix = `<<AGENT_END:${marker}:`
    const line =
      `{ printf '\\n<<A''GENT_BEG:${marker}>>\\n'; ${command.trim()}; __rc=$?; ` +
      `printf '\\n<<A''GENT_END:${marker}:%s>>\\n' "$__rc"; }\n`

    // 1) 下发命令,以「空闲 idleMs / 硬上限 hardMs」等待 END 哨兵。
    const { raw, finished, hitHard } = await new Promise<{
      raw: string
      finished: boolean
      hitHard: boolean
    }>((resolve) => {
      // Accumulate output in an array (join once at the end) and scan only a rolling
      // tail for the end sentinel, so a high-output command doesn't turn this into an
      // O(n²) concat+indexOf hot loop that stalls the main process.
      const parts: string[] = []
      let tail = ''
      const SENTINEL_SCAN = 512
      let done = false
      let lastDataAt = Date.now()
      const startedAt = Date.now()
      const finish = (f: boolean, hard: boolean): void => {
        if (done) return
        done = true
        channel.removeListener('data', onData)
        clearInterval(tick)
        resolve({ raw: parts.join(''), finished: f, hitHard: hard })
      }
      const onData = (chunk: Buffer): void => {
        if (done) return
        const text = chunk.toString('utf8')
        parts.push(text)
        lastDataAt = Date.now()
        // The sentinel is short and only appears at the very end; searching tail+text
        // (tail carries enough prior bytes to span a chunk boundary) suffices.
        const hay = tail + text
        const endIdx = hay.indexOf(endOutPrefix)
        if (endIdx !== -1 && hay.indexOf('>>', endIdx + endOutPrefix.length) !== -1) {
          finish(true, false)
          return
        }
        tail = hay.length > SENTINEL_SCAN ? hay.slice(-SENTINEL_SCAN) : hay
      }
      const tick = setInterval(() => {
        const now = Date.now()
        if (now - startedAt >= hardMs) finish(false, true)
        else if (now - lastDataAt >= idleMs) finish(false, false)
      }, 500)
      channel.on('data', onData)
      channel.write(line)
    })

    // 2a) 正常跑完。
    if (finished) {
      const { output, exitCode } = this.parseShellOutput(raw, begOut, endOutPrefix)
      return { output, exitCode, timedOut: false, state: 'completed' }
    }

    // 2b) 未完成:静默或超硬上限 → 诊断 + 夺回终端。
    const partial = this.parseShellOutput(raw, begOut, endOutPrefix).output
    const waiting = looksLikePrompt(partial)
    const rec = await this.ensureReady(channel)
    const reasons: string[] = [
      hitHard
        ? `命令超过 ${Math.round(hardMs / 1000)}s 硬上限`
        : `命令静默超过 ${Math.round(idleMs / 1000)}s 无输出`
    ]
    if (waiting) {
      reasons.push('疑似在等待输入(改用 -y / 预置输入 / yes | 前置,或换非交互方式)')
    }
    if (rec.ok) {
      reasons.push(rec.note ?? '已恢复终端')
      return {
        output: partial,
        exitCode: null,
        timedOut: true,
        state: 'interrupted',
        note: reasons.join(';')
      }
    }
    reasons.push(rec.note ?? '')
    reasons.push('无法自动恢复,建议断开重连该终端')
    return {
      output: partial,
      exitCode: null,
      timedOut: true,
      state: 'stuck',
      note: reasons.filter(Boolean).join(';')
    }
  }

  /**
   * 探测该终端会话里「用户此刻所在的目录」,用于 SFTP 面板首次打开时对齐命令行位置。
   *
   * 不往用户的 shell 里写任何东西(不打扰、不留痕),而是在同一条 SSH 连接上另开一个
   * exec 通道,从 /proc 里反查:exec 进程与交互 shell 是同一个 sshd 会话进程的兄弟,
   * 于是「父进程的其它带 pty 的子进程」就是这个终端的 shell,它的 /proc/<pid>/cwd
   * 即当前目录。再顺着同一 pty 向下走几层(su / 嵌套 shell / 前台程序),取能读到的
   * 最深一层,这样 `sudo -i` 之后 cd 过的目录也能对上。
   *
   * 非 Linux(无 /proc)、权限不足或任何异常都返回 null,由调用方退回默认目录。
   */
  async shellCwd(sessionId: string): Promise<string | null> {
    const script = [
      'P=$(sed -n "s/^PPid:[[:space:]]*//p" /proc/$$/status 2>/dev/null)',
      '[ -n "$P" ] || exit 0',
      'kids() { for f in $(grep -ls "^PPid:[[:space:]]*$1$" /proc/[0-9]*/status 2>/dev/null); do',
      '  f=${f%/status}; echo ${f#/proc/}; done; }',
      'ttyof() { readlink /proc/$1/fd/0 2>/dev/null; }',
      'cur=; dir=',
      'for k in $(kids "$P"); do',
      '  [ "$k" = "$$" ] && continue',
      '  case "$(ttyof $k)" in /dev/pts/*|/dev/tty*) ;; *) continue ;; esac',
      '  d=$(readlink /proc/$k/cwd 2>/dev/null)',
      '  [ -n "$d" ] && { cur=$k; dir=$d; break; }',
      'done',
      '[ -n "$cur" ] || exit 0',
      'n=0',
      'while [ $n -lt 8 ]; do',
      '  n=$((n+1)); next=',
      '  for k in $(kids "$cur"); do',
      '    case "$(ttyof $k)" in /dev/pts/*|/dev/tty*) ;; *) continue ;; esac',
      '    d=$(readlink /proc/$k/cwd 2>/dev/null)',
      '    [ -n "$d" ] && { next=$k; dir=$d; break; }',
      '  done',
      '  [ -n "$next" ] || break',
      '  cur=$next',
      'done',
      'echo "$dir"'
    ].join('\n')

    let out: string
    try {
      out = await Promise.race([
        this.exec(sessionId, script),
        new Promise<string>((_r, reject) =>
          setTimeout(() => reject(new Error('cwd probe timeout')), CWD_PROBE_TIMEOUT_MS)
        )
      ])
    } catch {
      return null
    }
    // 只认干净的绝对路径:探测失败时远端可能回一段错误提示,别把它当目录用。
    const line = out.split('\n')[0].trim()
    if (!line.startsWith('/') || /[\r\n]/.test(line)) return null
    return line
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.channel?.close()
      session.client.end()
      this.sessions.delete(sessionId)
    }
    this.disposeOutput(sessionId)
    this.buffers.delete(sessionId)
  }

  getClient(sessionId: string): Client | undefined {
    return this.sessions.get(sessionId)?.client
  }
}

export const sshManager = new SshManager()
