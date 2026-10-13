// Which shell the renderer is running in. The desktop app and the web edition share
// every component; the few desktop-only affordances (window controls, tab tear-off,
// remote desktop, native drag-out) check IS_WEB.

export interface WebFeatures {
  /** The server's own filesystem / shell ("local" pane, agent local:exec) is enabled. */
  local: boolean
}

declare global {
  interface Window {
    /** Set by the web client entry from GET /api/info before the app mounts. */
    __nebuWeb?: { features: WebFeatures; version: string }
  }
}

export const IS_WEB = import.meta.env.VITE_NEBU_WEB === 'true'

export function webFeatures(): WebFeatures {
  return window.__nebuWeb?.features ?? { local: true }
}

/**
 * Window event the web client fires after its WebSocket came back from a drop. Pushes
 * sent meanwhile were lost, so live views (terminals) refetch their state on it.
 */
export const WEB_RECONNECTED_EVENT = 'nebu-web-reconnected'

/** "Local" in the UI: this computer on desktop, the server itself on web. */
export const LOCAL_LABEL = IS_WEB ? '服务器本机' : '本地'
