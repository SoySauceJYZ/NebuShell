/**
 * When a tab is torn off into another window, the origin window removes it from its
 * store — which unmounts TerminalTab / RemotePane, whose cleanup normally disconnects
 * the session. That would kill the very session we're moving. Before removing the tab
 * we `markDetaching(sessionId)`; the unmount cleanup calls `consumeDetaching(sessionId)`
 * and skips the disconnect exactly once, leaving the session alive for the new window.
 */
const detaching = new Set<string>()

export function markDetaching(sessionId: string): void {
  detaching.add(sessionId)
}

/** True (once) if this session is being torn off, meaning unmount must NOT disconnect. */
export function consumeDetaching(sessionId: string): boolean {
  return detaching.delete(sessionId)
}
