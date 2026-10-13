import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { config } from './config'

// Stand-in for the `electron` module when src/main is bundled for the headless web
// server (aliased in vite.web.config.ts). It provides exactly the surface the shared
// IPC handlers and managers use: ipcMain registers into tables that the WebSocket hub
// dispatches from, app.getPath points into --data-dir, and everything that needs a
// desktop (dialogs, shell, safeStorage) is unavailable. The browser client intercepts
// the channels whose handlers would reach those, so the throws below are a backstop.

declare const __NEBU_VERSION__: string

/** What a handler sees as `event.sender`: one connected browser page. */
export interface WebSender {
  readonly id: number
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

export interface WebIpcEvent {
  sender: WebSender
}

type Handler = (event: WebIpcEvent, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const listeners = new Map<string, Handler>()

export function getHandler(channel: string): Handler | undefined {
  return handlers.get(channel)
}

export function getListener(channel: string): Handler | undefined {
  return listeners.get(channel)
}

export const ipcMain = {
  handle(channel: string, fn: Handler): void {
    if (handlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`)
    }
    handlers.set(channel, fn)
  },
  removeHandler(channel: string): void {
    handlers.delete(channel)
  },
  on(channel: string, fn: Handler): typeof ipcMain {
    listeners.set(channel, fn)
    return ipcMain
  }
}

function notSupported(what: string): never {
  throw new Error(`${what} 在 Web 版中不可用`)
}

const paths: Record<string, string> = {
  userData: config.dataDir,
  temp: join(config.dataDir, 'tmp'),
  downloads: join(config.dataDir, 'downloads'),
  home: homedir()
}

export const app = {
  getPath(name: string): string {
    return paths[name] ?? join(tmpdir(), 'nebushell-web')
  },
  getVersion(): string {
    return __NEBU_VERSION__
  },
  on(): typeof app {
    return app
  },
  whenReady(): Promise<void> {
    return Promise.resolve()
  },
  quit(): void {
    process.exit(0)
  }
}

// No OS keyring on a headless box: "trust this device" reports unsupported and the
// unlock screen simply never offers it.
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (): never => notSupported('安全存储'),
  decryptString: (): never => notSupported('安全存储')
}

export const dialog = {
  showSaveDialog: (): never => notSupported('系统对话框'),
  showOpenDialog: (): never => notSupported('系统对话框'),
  showMessageBox: (): never => notSupported('系统对话框')
}

export const shell = {
  openExternal: (): never => notSupported('打开外部链接'),
  showItemInFolder: (): never => notSupported('在文件夹中显示')
}

export const nativeImage = {
  createFromDataURL: (): Record<string, never> => ({})
}

/** Just enough for `BrowserWindow.fromWebContents(e.sender).webContents.send(...)`. */
export class BrowserWindow {
  private constructor(readonly webContents: WebSender) {}

  static fromWebContents(wc: WebSender | null | undefined): BrowserWindow | null {
    return wc ? new BrowserWindow(wc) : null
  }

  static getAllWindows(): BrowserWindow[] {
    return []
  }

  isDestroyed(): boolean {
    return this.webContents.isDestroyed()
  }
}

export default { ipcMain, app, safeStorage, dialog, shell, nativeImage, BrowserWindow }
