import { shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { AdoptPayload } from '../shared/types'

// All live app windows. Used to broadcast session-scoped events (each channel is keyed
// by a unique sessionId, so only the window holding that tab actually listens) and to
// hit-test which window a torn-off tab was dropped onto.
const windows = new Set<BrowserWindow>()

// Tabs torn off into a freshly created window, keyed by that window's webContents id.
// The new renderer pulls its payload via `window:takePendingAdopt` once it has loaded.
const pendingAdopt = new Map<number, AdoptPayload>()

/** Create an app window (the first window and every torn-off window go through here). */
export function createAppWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'

  // On macOS keep the native traffic lights (hiddenInset); on Windows/Linux go fully
  // frameless and draw our own controls in the tab bar so heights match exactly.
  const win = new BrowserWindow({
    title: 'NebuShell',
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#f7f6f2',
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : {}),
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  windows.add(win)
  win.on('closed', () => {
    windows.delete(win)
    pendingAdopt.delete(win.webContents.id)
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** Send an event to every live window. Session channels are unique, so only the owner reacts. */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

/**
 * The window whose bounds contain the given screen point, excluding `exclude`. Electron
 * exposes no z-order, so with overlapping windows this returns any match — good enough
 * since the common case is a single other window.
 */
export function windowAtScreenPoint(
  x: number,
  y: number,
  exclude?: BrowserWindow
): BrowserWindow | null {
  for (const win of windows) {
    if (win === exclude || win.isDestroyed() || win.isMinimized()) continue
    const b = win.getBounds()
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return win
  }
  return null
}

export function setPendingAdopt(webContentsId: number, payload: AdoptPayload): void {
  pendingAdopt.set(webContentsId, payload)
}

export function takePendingAdopt(webContentsId: number): AdoptPayload | null {
  const payload = pendingAdopt.get(webContentsId) ?? null
  pendingAdopt.delete(webContentsId)
  return payload
}
