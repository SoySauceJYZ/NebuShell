import * as transport from './transport'
import {
  confirmModal,
  pickBrowserFiles,
  downloadText,
  type ConfirmOptions
} from '@renderer/lib/webDialogs'
import {
  uploadToServer,
  consumeUploadedPaths,
  allocDownloadDir,
  deliverDownload
} from '@renderer/lib/webTransfer'

// IPC channels the browser answers itself (or wraps) instead of forwarding as-is: the
// login flow, and everything that on desktop opens a native dialog, the OS file manager
// or the system browser. Components keep calling window.api exactly as on desktop.

type Override = (...args: unknown[]) => unknown

interface Info {
  initialized: boolean
  authenticated: boolean
}

async function fetchInfo(): Promise<Info> {
  const res = await fetch('/api/info', { cache: 'no-store' })
  return (await res.json()) as Info
}

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
}

/** After a successful login: open the socket and hand back the vault, like desktop does. */
async function enter(): Promise<unknown> {
  await transport.connect()
  return transport.invoke('vault:getData', [])
}

function openExternal(url: unknown): void {
  const u = new URL(String(url))
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只能打开 http(s) 链接')
  window.open(u.href, '_blank', 'noopener,noreferrer')
}

const forward = (ch: string, args: unknown[]): Promise<unknown> => transport.invoke(ch, args)

const overrides: Record<string, Override> = {
  // ---- Login ----------------------------------------------------------------------
  'vault:isInitialized': async () => (await fetchInfo()).initialized,
  'vault:isUnlocked': async () => {
    const { authenticated } = await fetchInfo()
    if (authenticated) await transport.connect()
    return authenticated
  },
  'vault:create': async (password) => {
    await post('/api/setup', { password })
    return enter()
  },
  'vault:unlock': async (password) => {
    await post('/api/login', { password })
    return enter()
  },
  // No OS keyring on the server; the gate never offers "trust this device".
  'vault:isTrusted': () => false,
  'vault:isTrustSupported': () => false,
  'vault:unlockTrusted': () => null,
  'vault:setTrusted': () => false,

  // ---- Native dialogs → browser equivalents ----------------------------------------
  'dialog:confirm': (opts) => confirmModal(opts as ConfirmOptions),
  'file:saveText': (name, content) => {
    const filename = String(name || 'untitled.txt')
    downloadText(filename, String(content))
    return filename
  },
  'vault:export': async (password) => {
    const json = (await forward('vault:exportContent', [password])) as string
    const filename = `ssh-vault-export-${new Date().toISOString().slice(0, 10)}.json`
    downloadText(filename, json, 'application/json')
    return filename
  },
  'vault:import:pickFile': async () => {
    const [file] = await pickBrowserFiles({ multiple: false, accept: '.json,application/json' })
    return file ? file.text() : null
  },
  'local:openUrl': (url) => openExternal(url),
  'update:openDownload': (url) => openExternal(url),
  'mcp:showAuditLog': () => {
    throw new Error('Web 版请在服务器数据目录中查看 mcp-audit.log')
  },

  // ---- Files between the browser's computer and the server --------------------------
  // "Pick local files" = pick in the browser and stage them on the server.
  'local:pickFiles': async () => uploadToServer(await pickBrowserFiles()),
  // "Pick a local folder" (download target) = a staging dir the browser then fetches from.
  'local:pickDir': () => allocDownloadDir(),
  'sftp:uploadPaths': async (sessionId, remoteDir, localPaths, transferId) => {
    try {
      return await forward('sftp:uploadPaths', [sessionId, remoteDir, localPaths, transferId])
    } finally {
      consumeUploadedPaths(localPaths as string[])
    }
  },
  'containerFs:uploadPaths': async (sessionId, dir, localPaths, transferId) => {
    try {
      return await forward('containerFs:uploadPaths', [sessionId, dir, localPaths, transferId])
    } finally {
      consumeUploadedPaths(localPaths as string[])
    }
  },
  'local:copy': async (src, dstDir, transferId) => {
    try {
      return await forward('local:copy', [src, dstDir, transferId])
    } finally {
      consumeUploadedPaths([src as string])
    }
  },
  'sftp:downloadTo': async (sessionId, remotePath, localDir, transferId) => {
    const r = await forward('sftp:downloadTo', [sessionId, remotePath, localDir, transferId])
    deliverDownload(String(localDir), String(remotePath))
    return r
  },
  'containerFs:downloadTo': async (sessionId, path, localDir, transferId) => {
    const r = await forward('containerFs:downloadTo', [sessionId, path, localDir, transferId])
    deliverDownload(String(localDir), String(path))
    return r
  },
  // Single-file variants that open a native save/open dialog on desktop.
  'sftp:download': async (sessionId, remotePath) => {
    const dir = await allocDownloadDir()
    await forward('sftp:downloadTo', [sessionId, remotePath, dir, `dl-${Date.now()}`])
    deliverDownload(dir, String(remotePath))
    return remotePath
  },
  'sftp:upload': async (sessionId, remoteDir) => {
    const paths = await uploadToServer(await pickBrowserFiles({ multiple: false }))
    if (paths.length === 0) return null
    try {
      await forward('sftp:uploadPaths', [sessionId, remoteDir, paths, `ul-${Date.now()}`])
    } finally {
      consumeUploadedPaths(paths)
    }
    return paths[0]
  },

  // ---- Desktop window management: nothing to do in a browser tab -------------------
  'window:minimize': () => undefined,
  'window:toggleMaximize': () => false,
  'window:close': () => undefined,
  'window:isMaximized': () => false,
  'window:detachTab': () => undefined,
  'window:takePendingAdopt': () => null
}

const ignoredSends = new Set(['window:subscribeMaximize', 'sftp:startDrag'])

export function invokeChannel(ch: string, args: unknown[]): Promise<unknown> {
  const fn = overrides[ch]
  if (fn) {
    try {
      return Promise.resolve(fn(...args))
    } catch (err) {
      return Promise.reject(err)
    }
  }
  if (ch.startsWith('rd:')) return Promise.reject(new Error('远程桌面在 Web 版中不可用'))
  return forward(ch, args)
}

export function sendChannel(ch: string, args: unknown[]): void {
  if (ignoredSends.has(ch) || ch.startsWith('rd:')) return
  transport.send(ch, args)
}
