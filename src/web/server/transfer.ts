import type { IncomingMessage, ServerResponse } from 'http'
import { createReadStream, createWriteStream, promises as fsp } from 'fs'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { config } from './config'

// Moving files between the user's own computer and the server. Everything rides on the
// existing transfer code by going through a staging directory on the server:
//  - upload: the browser POSTs each file into a staging dir, gets back server paths,
//    and then calls the ordinary `sftp:uploadPaths` / `containerFs:uploadPaths` /
//    `local:copy` with them (progress, queue and concurrency unchanged);
//  - download: the browser asks for a staging dir to use as the "local" target of
//    `sftp:downloadTo` / `containerFs:downloadTo`, then fetches the result over HTTP
//    (a directory arrives as .tar.gz).
// Staging dirs are swept after a few hours, and each fetched item is removed at once.

const ROOT = join(config.dataDir, 'web-transfer')
const ID_RE = /^[0-9a-f-]{36}$/
const MAX_AGE_MS = 6 * 3600 * 1000
const SWEEP_MS = 10 * 60 * 1000

function safeName(name: string): string | null {
  if (!name || name.length > 255) return null
  if (name === '.' || name === '..' || /[\\/\0]/.test(name)) return null
  return name
}

function stagingDir(id: string): string | null {
  return ID_RE.test(id) ? join(ROOT, id) : null
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export async function initTransfers(): Promise<void> {
  // Anything left from a previous run is unreachable now.
  await fsp.rm(ROOT, { recursive: true, force: true })
  await fsp.mkdir(ROOT, { recursive: true })
  setInterval(() => void sweep(), SWEEP_MS).unref()
}

async function sweep(): Promise<void> {
  const now = Date.now()
  for (const name of await fsp.readdir(ROOT).catch(() => [] as string[])) {
    const p = join(ROOT, name)
    const st = await fsp.stat(p).catch(() => null)
    if (st && now - st.mtimeMs > MAX_AGE_MS) await fsp.rm(p, { recursive: true, force: true })
  }
}

/** POST /api/transfer/alloc → { id, path }: a fresh staging dir. */
export async function handleAlloc(res: ServerResponse): Promise<void> {
  const id = randomUUID()
  const path = join(ROOT, id)
  await fsp.mkdir(path, { recursive: true })
  json(res, 200, { id, path })
}

/** POST /api/transfer/upload?id=&name= (raw body) → { path }. */
export async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const dir = stagingDir(url.searchParams.get('id') ?? '')
  const name = safeName(url.searchParams.get('name') ?? '')
  if (!dir || !name) return json(res, 400, { error: 'bad id or name' })
  await fsp.mkdir(dir, { recursive: true })
  const path = join(dir, name)
  try {
    await pipeline(req, createWriteStream(path))
  } catch (err) {
    await fsp.rm(path, { force: true })
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
  json(res, 200, { path })
}

/** POST /api/transfer/release?id=: the upload that used this staging dir is done. */
export async function handleRelease(res: ServerResponse, url: URL): Promise<void> {
  const dir = stagingDir(url.searchParams.get('id') ?? '')
  if (!dir) return json(res, 400, { error: 'bad id' })
  await fsp.rm(dir, { recursive: true, force: true })
  json(res, 200, { ok: true })
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** GET /api/transfer/fetch?id=&name=: stream a staged file (or a directory as .tar.gz). */
export async function handleFetch(res: ServerResponse, url: URL): Promise<void> {
  const dir = stagingDir(url.searchParams.get('id') ?? '')
  const name = safeName(url.searchParams.get('name') ?? '')
  if (!dir || !name) return json(res, 400, { error: 'bad id or name' })
  const path = join(dir, name)
  const st = await fsp.stat(path).catch(() => null)
  if (!st) return json(res, 404, { error: 'not found' })

  const cleanup = (): void => void fsp.rm(path, { recursive: true, force: true })

  if (st.isDirectory()) {
    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Disposition': contentDisposition(`${name}.tar.gz`)
    })
    const tar = spawn('tar', ['-czf', '-', '-C', dir, name], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    tar.stdout.pipe(res)
    tar.on('close', cleanup)
    res.on('close', () => tar.kill())
    return
  }

  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Disposition': contentDisposition(basename(path))
  })
  try {
    await pipeline(createReadStream(path), res)
  } catch {
    // Browser cancelled the download.
  } finally {
    cleanup()
  }
}
