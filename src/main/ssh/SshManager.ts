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

// Cap on the per-session replay buffer (chars). Enough to rebuild a few screens of
// scrollback when a tab is torn off into a new window, without unbounded growth.
const REPLAY_CAP = 200_000

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

  private appendBuffer(sessionId: string, chunk: string): void {
    const next = (this.buffers.get(sessionId) ?? '') + chunk
    this.buffers.set(sessionId, next.length > REPLAY_CAP ? next.slice(-REPLAY_CAP) : next)
  }

  replay(sessionId: string): string {
    return this.buffers.get(sessionId) ?? ''
  }

  async connect(opts: SshConnectOptions): Promise<void> {
    const sock = await createNoDelaySocket(opts.host, opts.port)

    return new Promise((resolve, reject) => {
      const client = new Client()
      this.sessions.set(opts.sessionId, { client, channel: null })

      client
        .on('ready', () => {
          client.shell({ term: 'xterm-256color' }, (err, channel) => {
            if (err) {
              reject(err)
              return
            }
            const session = this.sessions.get(opts.sessionId)
            if (session) session.channel = channel

            channel.on('data', (chunk: Buffer) => {
              const text = chunk.toString('utf8')
              this.appendBuffer(opts.sessionId, text)
              broadcast(`ssh:data:${opts.sessionId}`, text)
            })
            channel.stderr.on('data', (chunk: Buffer) => {
              const text = chunk.toString('utf8')
              this.appendBuffer(opts.sessionId, text)
              broadcast(`ssh:data:${opts.sessionId}`, text)
            })
            channel.on('close', () => {
              broadcast(`ssh:closed:${opts.sessionId}`)
              // Only remove the map entry if it still points to THIS client — during a
              // reconnect a newer session may already own this id, and we must not delete it.
              if (this.sessions.get(opts.sessionId)?.client === client) {
                this.sessions.delete(opts.sessionId)
              }
              client.end()
            })
            resolve()
          })
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
      let buffer = ''
      let done = false
      let lastDataAt = Date.now()
      const startedAt = Date.now()
      const finish = (f: boolean, hard: boolean): void => {
        if (done) return
        done = true
        channel.removeListener('data', onData)
        clearInterval(tick)
        resolve({ raw: buffer, finished: f, hitHard: hard })
      }
      const onData = (chunk: Buffer): void => {
        if (done) return
        buffer += chunk.toString('utf8')
        lastDataAt = Date.now()
        const endIdx = buffer.indexOf(endOutPrefix)
        if (endIdx !== -1 && buffer.indexOf('>>', endIdx + endOutPrefix.length) !== -1) {
          finish(true, false)
        }
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

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.channel?.close()
      session.client.end()
      this.sessions.delete(sessionId)
    }
    this.buffers.delete(sessionId)
  }

  getClient(sessionId: string): Client | undefined {
    return this.sessions.get(sessionId)?.client
  }
}

export const sshManager = new SshManager()
