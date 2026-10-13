// Wire format between the browser client and the web server, shared by both sides.
// Every frame is JSON. Binary values (Uint8Array / ArrayBuffer / Node Buffer), which
// Electron IPC would structured-clone, travel as tagged base64.

export type ClientFrame =
  | { t: 'invoke'; id: number; ch: string; args: unknown[] }
  | { t: 'send'; ch: string; args: unknown[] }
  | { t: 'sub'; ch: string }
  | { t: 'unsub'; ch: string }

export type ServerFrame =
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'event'; ch: string; args: unknown[] }

/** Pushed to every page when the vault is locked; pages return to the unlock screen. */
export const LOGGED_OUT_EVENT = 'web:loggedOut'

/** WebSocket close code for "session no longer valid". */
export const CLOSE_UNAUTHORIZED = 4401

const B64 = '__nebuB64'

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeFrame(frame: ClientFrame | ServerFrame): string {
  return JSON.stringify(frame, (_key, value: unknown) => {
    if (value instanceof ArrayBuffer) return { [B64]: bytesToBase64(new Uint8Array(value)) }
    if (ArrayBuffer.isView(value)) {
      const v = value as ArrayBufferView
      return { [B64]: bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
    }
    // Node Buffers have already gone through Buffer#toJSON by the time we see them.
    if (
      value !== null &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === 'Buffer' &&
      Array.isArray((value as { data?: unknown }).data)
    ) {
      return { [B64]: bytesToBase64(Uint8Array.from((value as { data: number[] }).data)) }
    }
    return value
  })
}

export function decodeFrame<T>(text: string): T {
  return JSON.parse(text, (_key, value: unknown) => {
    if (value !== null && typeof value === 'object' && B64 in (value as object)) {
      return base64ToBytes((value as Record<string, string>)[B64])
    }
    return value
  }) as T
}
