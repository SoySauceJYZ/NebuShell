import {
  encodeFrame,
  decodeFrame,
  LOGGED_OUT_EVENT,
  CLOSE_UNAUTHORIZED,
  type ClientFrame,
  type ServerFrame
} from '../shared/wire'
import { WEB_RECONNECTED_EVENT } from '@renderer/lib/env'

// The browser end of the WebSocket that replaces Electron IPC. One socket per page,
// opened after login, reconnected with backoff. Subscriptions are reference-counted
// per channel and replayed on reconnect so pushes resume where they left off.

type Listener = (event: unknown, ...args: unknown[]) => void

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

const cid =
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

let socket: WebSocket | null = null
let wanted = false
let everOpened = false
let backoff = 500
let nextId = 1
const pending = new Map<number, Pending>()
const listeners = new Map<string, Set<Listener>>()
// Frames sent while the socket is (re)connecting.
let queue: string[] = []
let openWaiters: Array<() => void> = []
const statusListeners = new Set<(connected: boolean) => void>()

function setStatus(connected: boolean): void {
  for (const fn of statusListeners) fn(connected)
}

export function onConnectionStatus(fn: (connected: boolean) => void): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

function emitLocal(ch: string, args: unknown[]): void {
  for (const fn of [...(listeners.get(ch) ?? [])]) {
    try {
      fn({ sender: null }, ...args)
    } catch (err) {
      console.error(err)
    }
  }
}

function rawSend(frame: ClientFrame): void {
  const text = encodeFrame(frame)
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(text)
  else queue.push(text)
}

function onFrame(frame: ServerFrame): void {
  if (frame.t === 'result') {
    const p = pending.get(frame.id)
    if (!p) return
    pending.delete(frame.id)
    if (frame.ok) p.resolve(frame.value)
    else p.reject(new Error(frame.error))
  } else if (frame.t === 'event') {
    emitLocal(frame.ch, frame.args)
  }
}

function loggedOut(): void {
  wanted = false
  // Back to the unlock screen with a clean renderer.
  location.reload()
}

function open(): void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${proto}//${location.host}/ws?cid=${cid}`)
  socket = ws

  ws.onopen = () => {
    backoff = 500
    // Re-establish every subscription first, then flush what queued up meanwhile.
    for (const ch of listeners.keys()) ws.send(encodeFrame({ t: 'sub', ch }))
    for (const text of queue) ws.send(text)
    queue = []
    const waiters = openWaiters
    openWaiters = []
    for (const w of waiters) w()
    setStatus(true)
    if (everOpened) window.dispatchEvent(new Event(WEB_RECONNECTED_EVENT))
    everOpened = true
  }

  ws.onmessage = (e) => {
    let frame: ServerFrame
    try {
      frame = decodeFrame<ServerFrame>(String(e.data))
    } catch {
      return
    }
    if (frame.t === 'event' && frame.ch === LOGGED_OUT_EVENT) return loggedOut()
    onFrame(frame)
  }

  ws.onclose = (e) => {
    if (socket !== ws) return
    socket = null
    setStatus(false)
    // Calls in flight cannot be answered by the next socket.
    for (const p of pending.values()) p.reject(new Error('与服务器的连接已断开'))
    pending.clear()
    if (e.code === CLOSE_UNAUTHORIZED) return loggedOut()
    if (!wanted) return
    setTimeout(async () => {
      if (!wanted) return
      // A 401 on the upgrade shows up as a plain close; ask whether we are still signed in.
      const info = await fetch('/api/info')
        .then((r) => r.json())
        .catch(() => null)
      if (info && info.authenticated === false) return loggedOut()
      open()
    }, backoff)
    backoff = Math.min(backoff * 2, 10_000)
  }
}

/** Open the socket (after login). Resolves once connected. */
export function connect(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise((resolve) => {
    openWaiters.push(resolve)
    if (!wanted) {
      wanted = true
      open()
    }
  })
}

export function invoke(ch: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    rawSend({ t: 'invoke', id, ch, args })
  })
}

export function send(ch: string, args: unknown[]): void {
  rawSend({ t: 'send', ch, args })
}

export function on(ch: string, fn: Listener): void {
  let set = listeners.get(ch)
  if (!set) {
    set = new Set()
    listeners.set(ch, set)
    rawSendIfOpen({ t: 'sub', ch })
  }
  set.add(fn)
}

export function off(ch: string, fn: Listener): void {
  const set = listeners.get(ch)
  if (!set) return
  set.delete(fn)
  if (set.size === 0) {
    listeners.delete(ch)
    rawSendIfOpen({ t: 'unsub', ch })
  }
}

// Subscriptions made while disconnected are sent by onopen, so never queue them.
function rawSendIfOpen(frame: ClientFrame): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(encodeFrame(frame))
}
