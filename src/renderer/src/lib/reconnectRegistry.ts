/**
 * Lets code outside a TerminalTab (notably the AI agent) re-establish a terminal's
 * SSH connection and learn the outcome. Each mounted TerminalTab registers a
 * reconnect function keyed by its sessionId; callers look it up and await the result.
 *
 * This is the awaitable counterpart to the fire-and-forget `ssh-reconnect` window
 * event used by the tab menu — the agent needs to report success/failure back to the
 * model, which a CustomEvent can't provide.
 */
type Reconnector = () => Promise<void>

const registry = new Map<string, Reconnector>()

/** Register a session's reconnect fn; returns an unregister cleanup for unmount. */
export function registerReconnect(sessionId: string, fn: Reconnector): () => void {
  registry.set(sessionId, fn)
  return () => {
    if (registry.get(sessionId) === fn) registry.delete(sessionId)
  }
}

/**
 * Trigger a reconnect for the session. Resolves when the connection is (re)established,
 * rejects if it fails. Returns null when no live TerminalTab owns this session (its tab
 * isn't open), so the caller can distinguish "can't reconnect" from "reconnect failed".
 */
export function requestReconnect(sessionId: string): Promise<void> | null {
  const fn = registry.get(sessionId)
  return fn ? fn() : null
}

/** Whether a live TerminalTab is available to reconnect this session. */
export function canReconnect(sessionId: string): boolean {
  return registry.has(sessionId)
}
