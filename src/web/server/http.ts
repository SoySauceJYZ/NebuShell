import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { createReadStream, promises as fsp } from 'fs'
import { join, normalize, extname, sep } from 'path'
import { vaultManager } from '../../main/vault/VaultManager'
import { config } from './config'
import {
  isAuthenticated,
  issueSession,
  endSession,
  clientIp,
  loginRetryAfter,
  recordLoginFailure,
  recordLoginSuccess
} from './auth'
import { handleAlloc, handleUpload, handleFetch, handleRelease } from './transfer'

declare const __NEBU_VERSION__: string

// HTTP side of the web edition: the static browser bundle, the login endpoints and the
// browser↔server file staging routes. Everything else goes over the WebSocket hub.

const MAX_JSON_BODY = 64 * 1024

// Matches src/renderer/index.html, plus what a real http(s) origin needs: Monaco and
// pdf.js workers (worker-src) and the same-origin WebSocket (connect-src 'self').
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "connect-src 'self' ws: wss: blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8'
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_JSON_BODY) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

function info(req: IncomingMessage): Record<string, unknown> {
  return {
    initialized: vaultManager.isInitialized(),
    authenticated: vaultManager.isUnlocked() && isAuthenticated(req),
    version: __NEBU_VERSION__,
    platform: process.platform,
    versions: { node: process.versions.node },
    features: { local: config.local }
  }
}

async function login(req: IncomingMessage, res: ServerResponse, setup: boolean): Promise<void> {
  const ip = clientIp(req)
  const wait = loginRetryAfter(ip)
  if (wait > 0) {
    res.setHeader('Retry-After', String(Math.ceil(wait / 1000)))
    return json(res, 429, { error: `尝试次数过多,请 ${Math.ceil(wait / 1000)} 秒后再试` })
  }
  const body = await readJson(req)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password) return json(res, 400, { error: '请输入主密码' })

  if (setup) {
    if (vaultManager.isInitialized()) return json(res, 409, { error: '保险库已存在' })
    vaultManager.create(password)
  } else {
    if (!vaultManager.isInitialized()) return json(res, 409, { error: '保险库尚未创建' })
    let ok: boolean
    if (vaultManager.isUnlocked()) {
      ok = vaultManager.verifyPassword(password)
    } else {
      try {
        vaultManager.unlock(password)
        ok = true
      } catch {
        ok = false
      }
    }
    if (!ok) {
      recordLoginFailure(ip)
      console.warn(`[auth] failed login from ${ip}`)
      return json(res, 401, { error: 'Incorrect master password' })
    }
  }
  recordLoginSuccess(ip)
  issueSession(req, res)
  json(res, 200, { ok: true })
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const root = config.staticDir
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const file = normalize(join(root, rel))
  if (!file.startsWith(root + sep) && file !== root) return json(res, 403, { error: 'forbidden' })

  let target = file
  let st = await fsp.stat(target).catch(() => null)
  if (!st || !st.isFile()) {
    // Unknown non-asset paths fall back to the app shell.
    if (extname(rel)) return json(res, 404, { error: 'not found' })
    target = join(root, 'index.html')
    st = await fsp.stat(target).catch(() => null)
    if (!st) return json(res, 500, { error: 'client bundle missing; build with npm run build:web' })
  }
  const isHtml = target.endsWith('.html')
  res.writeHead(200, {
    'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
    'Content-Length': st.size,
    // Vite fingerprints everything under assets/, so those can be cached forever.
    'Cache-Control': isHtml
      ? 'no-cache'
      : rel.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    ...(isHtml ? { 'Content-Security-Policy': CSP } : {})
  })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(target).pipe(res)
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  const { pathname } = url
  const method = req.method ?? 'GET'

  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')

  if (!pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD')
      return json(res, 405, { error: 'method not allowed' })
    return serveStatic(req, res, pathname)
  }

  if (pathname === '/api/health') return json(res, 200, { ok: true })
  if (pathname === '/api/info' && method === 'GET') return json(res, 200, info(req))

  // Everything that changes state is POST + JSON or a raw body; SameSite=Strict on the
  // session cookie keeps cross-site pages from riding on it.
  if (pathname === '/api/setup' && method === 'POST') return login(req, res, true)
  if (pathname === '/api/login' && method === 'POST') return login(req, res, false)
  if (pathname === '/api/logout' && method === 'POST') {
    endSession(req, res)
    return json(res, 200, { ok: true })
  }

  if (!isAuthenticated(req) || !vaultManager.isUnlocked()) {
    return json(res, 401, { error: 'unauthorized' })
  }
  if (pathname === '/api/transfer/alloc' && method === 'POST') return handleAlloc(res)
  if (pathname === '/api/transfer/upload' && method === 'POST') return handleUpload(req, res, url)
  if (pathname === '/api/transfer/release' && method === 'POST') return handleRelease(res, url)
  if (pathname === '/api/transfer/fetch' && method === 'GET') return handleFetch(res, url)

  json(res, 404, { error: 'not found' })
}

export function createWebServer(): Server {
  return createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error('[http]', err)
      if (!res.headersSent)
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      else res.destroy()
    })
  })
}
