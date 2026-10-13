// Browser entry of the web edition. Order matters: the server's platform must be known
// before the preload builds `window.electron`, and `window.api` must exist before the
// renderer's modules (which read it at import time) are evaluated.
import { electronAPI } from './toolkitPreloadShim'
import { clipboard } from './electronShim'
import { onConnectionStatus } from './transport'

interface Info {
  version: string
  platform: string
  versions: Record<string, string>
  features: { local: boolean }
}

function showBanner(): () => void {
  const el = document.createElement('div')
  el.textContent = '与服务器的连接已断开,正在重连…'
  el.style.cssText =
    'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:300;padding:4px 14px;' +
    'font-size:12px;color:#fff;background:#c0392b;border-radius:0 0 8px 8px;'
  document.body.appendChild(el)
  return () => el.remove()
}

async function boot(): Promise<void> {
  const info = (await fetch('/api/info', { cache: 'no-store' }).then((r) => r.json())) as Info
  electronAPI.process.platform = info.platform
  electronAPI.process.versions = info.versions
  window.__nebuWeb = { features: info.features, version: info.version }

  await import('../../preload/index')
  // The shared preload reads the clipboard synchronously; give it the async browser path.
  window.api.clipboard.readTextAsync = clipboard.readTextAsync

  let hide: (() => void) | null = null
  onConnectionStatus((connected) => {
    if (connected) {
      hide?.()
      hide = null
    } else if (!hide) {
      hide = showBanner()
    }
  })

  // Closing the tab drops every terminal; Ctrl+W can't be intercepted, so at least ask.
  window.addEventListener('beforeunload', (e) => {
    if (document.querySelector('.xterm')) {
      e.preventDefault()
      e.returnValue = ''
    }
  })

  await import('../../renderer/src/main')
}

void boot()
