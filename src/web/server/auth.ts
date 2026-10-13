import type { IncomingMessage, ServerResponse } from 'http'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { config } from './config'

// Browser sessions for the single-user web edition. The vault master password is the
// login: a successful unlock/verify issues a random token held only in memory, so a
// server restart (which also re-locks the vault) logs everyone out.

const COOKIE = 'nebushell_sid'
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000

interface Session {
  expires: number
}

const sessions = new Map<string, Session>()

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/** True when the request reached the reverse proxy over https. */
function isSecure(req: IncomingMessage): boolean {
  if (config.trustProxy) {
    const proto = String(req.headers['x-forwarded-proto'] ?? '')
      .split(',')[0]
      .trim()
    if (proto) return proto === 'https'
  }
  return Boolean((req.socket as { encrypted?: boolean }).encrypted)
}

export function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      .trim()
    if (fwd) return fwd
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function isAuthenticated(req: IncomingMessage): boolean {
  const token = parseCookies(req)[COOKIE]
  if (!token) return false
  // Constant-time lookup: compare digests rather than relying on Map key equality alone.
  for (const [t, s] of sessions) {
    if (timingSafeEqual(digest(t), digest(token))) {
      if (s.expires < Date.now()) {
        sessions.delete(t)
        return false
      }
      return true
    }
  }
  return false
}

export function issueSession(req: IncomingMessage, res: ServerResponse): void {
  const token = randomBytes(32).toString('base64url')
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS })
  const attrs = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ]
  if (isSecure(req)) attrs.push('Secure')
  res.setHeader('Set-Cookie', attrs.join('; '))
}

export function endSession(req: IncomingMessage, res: ServerResponse): void {
  const token = parseCookies(req)[COOKIE]
  if (token) sessions.delete(token)
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
}

/** Locking the vault signs every browser out. */
export function revokeAllSessions(): void {
  sessions.clear()
}

// ---- Login throttling -------------------------------------------------------------
// Per client IP: the first few failures are free, then each further failure doubles a
// lockout (1s, 2s, 4s … capped at 15 min). A success clears the record.

const FREE_FAILURES = 5
const MAX_LOCK_MS = 15 * 60 * 1000

interface Attempts {
  failures: number
  lockedUntil: number
}

const attempts = new Map<string, Attempts>()

/** Milliseconds the caller still has to wait, or 0 when a login may be attempted. */
export function loginRetryAfter(ip: string): number {
  const a = attempts.get(ip)
  if (!a) return 0
  return Math.max(0, a.lockedUntil - Date.now())
}

export function recordLoginFailure(ip: string): void {
  const a = attempts.get(ip) ?? { failures: 0, lockedUntil: 0 }
  a.failures++
  if (a.failures > FREE_FAILURES) {
    a.lockedUntil = Date.now() + Math.min(MAX_LOCK_MS, 1000 * 2 ** (a.failures - FREE_FAILURES - 1))
  }
  attempts.set(ip, a)
}

export function recordLoginSuccess(ip: string): void {
  attempts.delete(ip)
}
