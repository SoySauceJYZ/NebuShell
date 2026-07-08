import { Client, type ClientChannel } from 'ssh2'
import type { BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'
import type { SshConnectOptions, RunShellResult } from '../../shared/types'
import { SAFE_ALGORITHMS, SAFE_KEEPALIVE_INTERVAL } from './algorithms'
import { createNoDelaySocket } from './createSocket'
import { foldTerminalOutput } from '../../shared/terminalFold'

interface Session {
  client: Client
  channel: ClientChannel | null
}

export class SshManager {
  private sessions = new Map<string, Session>()

  async connect(win: BrowserWindow, opts: SshConnectOptions): Promise<void> {
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
              win.webContents.send(`ssh:data:${opts.sessionId}`, chunk.toString('utf8'))
            })
            channel.stderr.on('data', (chunk: Buffer) => {
              win.webContents.send(`ssh:data:${opts.sessionId}`, chunk.toString('utf8'))
            })
            channel.on('close', () => {
              win.webContents.send(`ssh:closed:${opts.sessionId}`)
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
          win.webContents.send(`ssh:error:${opts.sessionId}`, err.message)
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
   * Runs a command inside the session's existing interactive shell (so the user sees
   * it live and it shares cwd/env), capturing just this command's output + exit code.
   * Sentinel markers are built via string concatenation ('A''GENT') so the OUTPUT marker
   * text differs from the shell's ECHO of the typed line — we only match the real output.
   */
  runInShell(sessionId: string, command: string, timeoutMs = 60000): Promise<RunShellResult> {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId)
      if (!session || !session.channel) {
        reject(new Error('终端会话不存在或未就绪'))
        return
      }
      const channel = session.channel
      const marker = randomBytes(6).toString('hex')
      const begOut = `<<AGENT_BEG:${marker}>>`
      const endOutPrefix = `<<AGENT_END:${marker}:`
      const line =
        `{ printf '\\n<<A''GENT_BEG:${marker}>>\\n'; ${command.trim()}; __rc=$?; ` +
        `printf '\\n<<A''GENT_END:${marker}:%s>>\\n' "$__rc"; }\n`

      let buffer = ''
      let done = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const parse = (raw: string, timedOut: boolean): RunShellResult => {
        const begIdx = raw.indexOf(begOut)
        const endIdx = raw.indexOf(endOutPrefix)
        let output = ''
        let exitCode: number | null = null
        if (begIdx !== -1 && endIdx !== -1 && endIdx > begIdx) {
          output = raw.slice(begIdx + begOut.length, endIdx)
          const rest = raw.slice(endIdx + endOutPrefix.length)
          const m = rest.match(/^(\d+)>>/)
          if (m) exitCode = Number(m[1])
        } else {
          output = raw
        }
        // L0:按终端语义折叠刷新帧(\r 覆盖、光标上移重绘),把 docker build 之类的
        // 进度刷屏坍缩回最后一屏,而不是留下几万行几乎相同的帧。
        output = foldTerminalOutput(output).replace(/^\n+/, '').replace(/\n+$/, '')
        return { output, exitCode, timedOut }
      }

      const cleanup = (): void => {
        channel.removeListener('data', onData)
        if (timer) clearTimeout(timer)
      }

      const onData = (chunk: Buffer): void => {
        if (done) return
        buffer += chunk.toString('utf8')
        const endIdx = buffer.indexOf(endOutPrefix)
        if (endIdx !== -1 && buffer.indexOf('>>', endIdx + endOutPrefix.length) !== -1) {
          done = true
          cleanup()
          resolve(parse(buffer, false))
        }
      }

      timer = setTimeout(() => {
        if (done) return
        done = true
        cleanup()
        resolve(parse(buffer, true))
      }, timeoutMs)

      channel.on('data', onData)
      channel.write(line)
    })
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.channel?.close()
      session.client.end()
      this.sessions.delete(sessionId)
    }
  }

  getClient(sessionId: string): Client | undefined {
    return this.sessions.get(sessionId)?.client
  }
}

export const sshManager = new SshManager()
