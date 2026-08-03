import { randomUUID } from 'crypto'
import { networkInterfaces } from 'os'
import { WebSocketServer, WebSocket } from 'ws'
import type { RdSignal, RdStartResult, RdAgentStatus } from '../../shared/types'

// 远程桌面信令中枢(main 进程)。渲染层有严格 CSP,无法直连 WebSocket,故所有信令
// 都经这里转发:被控端跑一个 ws 服务器,控制端跑一个 ws 客户端,SDP/ICE 在两端之间
// 透传;真正的音视频与输入 DataChannel 由两端渲染层的 RTCPeerConnection 直接 P2P 建立。
//
// 一个 App 既可作被控端也可作控制端,故这里统一用 rdSessionId 标识每条连接(被控端为
// 每个接入的控制端分配一个,控制端为自己发起的每次连接分配一个),sendSignal/onSignal
// 都按该 id 路由。第一步被控端只接受单个控制端(1:1),多控后续再做。

const PREFERRED_PORT = 46200

/** ws 上传输的信令帧。 */
type WireMessage =
  | { t: 'auth'; code: string }
  | { t: 'auth-ok' }
  | { t: 'auth-fail'; reason: string }
  | { t: 'signal'; signal: RdSignal }

class RemoteDesktopManager {
  private wss?: WebSocketServer
  private port = 0
  private accessCode = ''
  private serving = false
  /** rdSessionId → socket。同时覆盖被控端接入的控制端 socket 与控制端自身发起的 socket。 */
  private sockets = new Map<string, WebSocket>()
  /** 被控端当前接入的控制端会话 id(1:1)。 */
  private agentPeerId?: string

  // 由 IPC 层注入,用于把事件广播到渲染层。
  onSignal: (rdSessionId: string, signal: RdSignal) => void = () => {}
  onPeerConnect: (rdSessionId: string) => void = () => {}
  onPeerDisconnect: (rdSessionId: string) => void = () => {}

  // ---- 被控端(agent) -------------------------------------------------------

  async startAgent(): Promise<RdStartResult> {
    if (this.serving && this.wss) {
      return { port: this.port, ips: localIpv4s(), accessCode: this.accessCode }
    }
    this.accessCode = String(Math.floor(100000 + Math.random() * 900000))
    this.port = await this.listen(PREFERRED_PORT)
    this.serving = true
    return { port: this.port, ips: localIpv4s(), accessCode: this.accessCode }
  }

  stopAgent(): void {
    if (this.agentPeerId) {
      this.closeSocket(this.agentPeerId)
      this.agentPeerId = undefined
    }
    this.wss?.close()
    this.wss = undefined
    this.serving = false
    this.port = 0
    this.accessCode = ''
  }

  agentStatus(): RdAgentStatus {
    return {
      serving: this.serving,
      port: this.port,
      ips: localIpv4s(),
      accessCode: this.accessCode,
      peerConnected: !!this.agentPeerId
    }
  }

  /** 起 ws 服务器;首选端口被占用时回退到随机端口。resolve 实际监听端口。 */
  private listen(preferred: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number, allowFallback: boolean): void => {
        const wss = new WebSocketServer({ port, host: '0.0.0.0' })
        wss.once('error', (err: NodeJS.ErrnoException) => {
          wss.close()
          if (allowFallback && err.code === 'EADDRINUSE') tryPort(0, false)
          else reject(err)
        })
        wss.once('listening', () => {
          this.wss = wss
          wss.on('connection', (ws) => this.onAgentConnection(ws))
          const addr = wss.address()
          resolve(typeof addr === 'object' && addr ? addr.port : port)
        })
      }
      tryPort(preferred, true)
    })
  }

  private onAgentConnection(ws: WebSocket): void {
    let authed = false
    let rdSessionId = ''
    // 未认证前收到的第一条必须是 auth;认证前的其它消息一律忽略。
    ws.on('message', (raw) => {
      let msg: WireMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (!authed) {
        if (msg.t !== 'auth') return
        if (msg.code !== this.accessCode) {
          send(ws, { t: 'auth-fail', reason: '访问码错误' })
          ws.close()
          return
        }
        if (this.agentPeerId) {
          send(ws, { t: 'auth-fail', reason: '已有控制端连接' })
          ws.close()
          return
        }
        authed = true
        rdSessionId = randomUUID()
        this.agentPeerId = rdSessionId
        this.sockets.set(rdSessionId, ws)
        send(ws, { t: 'auth-ok' })
        this.onPeerConnect(rdSessionId)
        return
      }
      if (msg.t === 'signal') this.onSignal(rdSessionId, msg.signal)
    })
    ws.on('close', () => {
      if (!rdSessionId) return
      this.sockets.delete(rdSessionId)
      if (this.agentPeerId === rdSessionId) this.agentPeerId = undefined
      this.onPeerDisconnect(rdSessionId)
    })
    ws.on('error', () => ws.close())
  }

  // ---- 控制端(controller) --------------------------------------------------

  /** 连接被控端并完成访问码认证。成功后该 rdSessionId 即可收发信令。 */
  connect(rdSessionId: string, opts: { ip: string; port: number; code: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(`ws://${opts.ip}:${opts.port}`)
      ws.on('open', () => send(ws, { t: 'auth', code: opts.code }))
      ws.on('message', (raw) => {
        let msg: WireMessage
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (!settled) {
          if (msg.t === 'auth-ok') {
            settled = true
            this.sockets.set(rdSessionId, ws)
            resolve()
          } else if (msg.t === 'auth-fail') {
            settled = true
            ws.close()
            reject(new Error(msg.reason || '认证失败'))
          }
          return
        }
        if (msg.t === 'signal') this.onSignal(rdSessionId, msg.signal)
      })
      ws.on('close', () => {
        if (!settled) {
          settled = true
          reject(new Error('连接被关闭'))
          return
        }
        if (this.sockets.get(rdSessionId) === ws) {
          this.sockets.delete(rdSessionId)
          this.onPeerDisconnect(rdSessionId)
        }
      })
      ws.on('error', (err) => {
        if (!settled) {
          settled = true
          reject(err)
        }
      })
    })
  }

  // ---- 共用 -----------------------------------------------------------------

  sendSignal(rdSessionId: string, signal: RdSignal): void {
    const ws = this.sockets.get(rdSessionId)
    if (ws && ws.readyState === WebSocket.OPEN) send(ws, { t: 'signal', signal })
  }

  disconnect(rdSessionId: string): void {
    this.closeSocket(rdSessionId)
  }

  private closeSocket(rdSessionId: string): void {
    const ws = this.sockets.get(rdSessionId)
    if (ws) {
      this.sockets.delete(rdSessionId)
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }
}

function send(ws: WebSocket, msg: WireMessage): void {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    /* ignore */
  }
}

/** 本机所有非回环 IPv4 地址。 */
function localIpv4s(): string[] {
  const out: string[] = []
  const ifaces = networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address)
    }
  }
  return out
}

export const remoteDesktopManager = new RemoteDesktopManager()
