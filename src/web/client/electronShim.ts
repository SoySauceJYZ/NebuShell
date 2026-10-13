import * as transport from './transport'
import { invokeChannel, sendChannel } from './overrides'

// Stand-in for the `electron` module when src/preload is bundled into the browser
// (aliased in vite.web.config.ts). The preload's `window.api` is built unchanged on
// top of this: ipcRenderer goes over the WebSocket transport, clipboard over
// navigator.clipboard.

type Listener = (event: unknown, ...args: unknown[]) => void

export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => invokeChannel(channel, args),
  send: (channel: string, ...args: unknown[]): void => sendChannel(channel, args),
  on(channel: string, listener: Listener): typeof ipcRenderer {
    transport.on(channel, listener)
    return ipcRenderer
  },
  removeListener(channel: string, listener: Listener): typeof ipcRenderer {
    transport.off(channel, listener)
    return ipcRenderer
  }
}

export const contextBridge = {
  exposeInMainWorld(key: string, value: unknown): void {
    ;(window as unknown as Record<string, unknown>)[key] = value
  }
}

// The async Clipboard API needs a secure context (https or localhost). Without one, copy
// falls back to execCommand and paste is left to the browser's own Ctrl+V / menu.
let lastCopied = ''

function legacyCopy(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } finally {
    ta.remove()
  }
}

export const clipboard = {
  writeText(text: string): void {
    lastCopied = text
    if (navigator.clipboard && window.isSecureContext) {
      void navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
    } else {
      legacyCopy(text)
    }
  },
  /** Synchronous reads are impossible in a browser; returns what this page last copied. */
  readText(): string {
    return lastCopied
  },
  async readTextAsync(): Promise<string> {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        return await navigator.clipboard.readText()
      } catch {
        // Permission denied: fall through to what this page copied itself.
      }
    }
    return lastCopied
  }
}

export const webUtils = {
  // Browsers never expose disk paths; dropped files are uploaded instead (useFileDnd).
  getPathForFile: (): string => ''
}

export default { ipcRenderer, contextBridge, clipboard, webUtils }
