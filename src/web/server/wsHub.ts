import type { IncomingMessage, Server } from 'http'
import type { Duplex } from 'stream'
import { WebSocketServer, WebSocket } from 'ws'
import { getHandler, getListener, type WebSender, type WebIpcEvent } from './electronShim'
import { isAuthenticated, clientIp } from './auth'
import { config } from './config'
import {
  encodeFrame,
  decodeFrame,
  LOGGED_OUT_EVENT,
  CLOSE_UNAUTHORIZED,
  type ClientFrame,
  type ServerFrame
} from '../shared/wire'

// The web edition's replacement for Electron IPC. Each browser page is one client
// (identified by a per-page-load id it passes as ?cid=), which survives WebSocket
// reconnects: its WebSender stays the same object, so targeted pushes from handlers
// (`e.sender.send(...)`, transfer progress, LLM deltas) keep flowing after a network
// blip. Broadcasts (`ssh:data:<id>` etc.) only go to clients subscribed to the channel.

const PING_MS = 30_000
/** How long a vanished page keeps its SSH/SFTP sessions in case it reconnects. */
const GRACE_MS = 60_000
const MAX_PAYLOAD = 32 * 1024 * 1024
const CID_RE = /^[A-Za-z0-9_-]{8,64}$/

// Resources a page opens and must give back when it goes away for good. The key comes
// from the connect call's options; the release channel is invoked with that key.
const OWNED: Record<string, { kind: string; release: string }> = {
  'ssh:connect': { kind: 'ssh', release: 'ssh:disconnect' },
  'sftp:connect': { kind: 'sftp', release: 'sftp:disconnect' },
  'containerFs:connect': { kind: 'containerFs', release: 'containerFs:disconnect' }
}
const RELEASED: Record<string, string> = {
  'ssh:disconnect': 'ssh',
  'sftp:disconnect': 'sftp',
  'containerFs:disconnect': 'containerFs'
}

/** Channels the browser must not reach over the socket. */
function blockedReason(ch: string): string | null {
  // Unlocking goes through POST /api/login so it is rate limited.
  if (ch === 'vault:create' || ch === 'vault:unlock') return '请通过登录接口解锁'
  if (!config.local && ch.startsWith('local:')) return '服务器本机功能已被管理员关闭(--no-local)'
  return null
}

interface Client {
  cid: string
  socket: WebSocket | null
  subs: Set<string>
  /** `${kind}:${sessionId}` → release channel. */
  owned: Map<string, { release: string; id: string }>
  grace: ReturnType<typeof setTimeout> | null
  sender: WebSender
  destroyed: boolean
}

let nextSenderId = 1
const clients = new Map<string, Client>()

function sendFrame(socket: WebSocket | null, frame: ServerFrame): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(encodeFrame(frame))
}

function makeClient(cid: string): Client {
  const id = nextSenderId++
  const client: Client = {
    cid,
    socket: null,
    subs: new Set(),
    owned: new Map(),
    grace: null,
    destroyed: false,
    sender: {
      id,
      send: (ch, ...args) => sendFrame(client.socket, { t: 'event', ch, args }),
      isDestroyed: () => client.destroyed
    }
  }
  return client
}

function releaseAll(client: Client): void {
  const event: WebIpcEvent = { sender: client.sender }
  for (const { release, id } of client.owned.values()) {
    try {
      void Promise.resolve(getHandler(release)?.(event, id)).catch(() => undefined)
    } catch {
      // A session that already died on its own is fine to skip.
    }
  }
  client.owned.clear()
}

function dropClient(client: Client): void {
  client.destroyed = true
  releaseAll(client)
  clients.delete(client.cid)
}

function trackOwnership(client: Client, ch: string, args: unknown[]): void {
  const own = OWNED[ch]
  if (own) {
    const sessionId = (args[0] as { sessionId?: unknown } | undefined)?.sessionId
    if (typeof sessionId === 'string') {
      client.owned.set(`${own.kind}:${sessionId}`, { release: own.release, id: sessionId })
    }
    return
  }
  const kind = RELEASED[ch]
  if (kind && typeof args[0] === 'string') client.owned.delete(`${kind}:${args[0]}`)
}

async function onInvoke(client: Client, id: number, ch: string, args: unknown[]): Promise<void> {
  const reply = (frame: ServerFrame): void => sendFrame(client.socket, frame)
  const blocked = blockedReason(ch)
  const handler = getHandler(ch)
  if (blocked || !handler) {
    reply({ t: 'result', id, ok: false, error: blocked ?? `No handler registered for '${ch}'` })
    return
  }
  try {
    const value = await handler({ sender: client.sender }, ...args)
    trackOwnership(client, ch, args)
    reply({ t: 'result', id, ok: true, value: value === undefined ? null : value })
  } catch (err) {
    reply({ t: 'result', id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

function onMessage(client: Client, raw: string): void {
  let frame: ClientFrame
  try {
    frame = decodeFrame<ClientFrame>(raw)
  } catch {
    return
  }
  switch (frame.t) {
    case 'invoke':
      void onInvoke(client, frame.id, frame.ch, frame.args ?? [])
      break
    case 'send': {
      if (blockedReason(frame.ch)) return
      try {
        void Promise.resolve(
          getListener(frame.ch)?.({ sender: client.sender }, ...(frame.args ?? []))
        ).catch(() => undefined)
      } catch {
        // Fire-and-forget, like ipcRenderer.send.
      }
      break
    }
    case 'sub':
      client.subs.add(frame.ch)
      break
    case 'unsub':
      client.subs.delete(frame.ch)
      break
  }
}

/** Broadcast sink: every page subscribed to the channel. */
export function broadcastToClients(ch: string, args: unknown[]): void {
  for (const client of clients.values()) {
    if (client.subs.has(ch)) sendFrame(client.socket, { t: 'event', ch, args })
  }
}

/** Vault locked: tell every page, then cut the sockets. Sessions are released by grace expiry. */
export function logoutAll(): void {
  for (const client of clients.values()) {
    sendFrame(client.socket, { t: 'event', ch: LOGGED_OUT_EVENT, args: [] })
    client.socket?.close(CLOSE_UNAUTHORIZED, 'logged out')
  }
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return false
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  const fwdHost = config.trustProxy
    ? String(req.headers['x-forwarded-host'] ?? '')
        .split(',')[0]
        .trim()
    : ''
  const host = fwdHost || req.headers.host || ''
  return originHost.toLowerCase() === host.toLowerCase()
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

export function attachWsHub(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname !== '/ws') return reject(socket, 404, 'Not Found')
    // Cross-site WebSocket hijacking: the cookie alone would be sent by any page.
    if (!originAllowed(req)) return reject(socket, 403, 'Forbidden')
    if (!isAuthenticated(req)) return reject(socket, 401, 'Unauthorized')
    const cid = url.searchParams.get('cid') ?? ''
    if (!CID_RE.test(cid)) return reject(socket, 400, 'Bad Request')

    wss.handleUpgrade(req, socket, head, (ws) => {
      let client = clients.get(cid)
      if (!client) {
        client = makeClient(cid)
        clients.set(cid, client)
      }
      if (client.grace) {
        clearTimeout(client.grace)
        client.grace = null
      }
      // A second socket for the same page replaces the first.
      client.socket?.close(1000, 'replaced')
      client.socket = ws
      const c = client

      let alive = true
      ws.on('pong', () => (alive = true))
      const ping = setInterval(() => {
        if (!alive) return ws.terminate()
        alive = false
        ws.ping()
      }, PING_MS)

      ws.on('message', (data) => onMessage(c, data.toString()))
      ws.on('close', () => {
        clearInterval(ping)
        if (c.socket !== ws) return
        c.socket = null
        c.grace = setTimeout(() => dropClient(c), GRACE_MS)
      })
      ws.on('error', () => undefined)
      console.log(`[ws] page connected from ${clientIp(req)}`)
    })
  })
}
