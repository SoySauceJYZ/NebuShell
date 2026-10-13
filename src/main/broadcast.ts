// Session-scoped push events (`ssh:data:<id>`, `update:available`, …) go through here
// rather than straight to BrowserWindows, so the same managers can run under Electron
// (sink = every app window, see ./windows) or the headless web server (sink = the
// WebSocket hub, see src/web/server/wsHub).

type Sink = (channel: string, args: unknown[]) => void

let sink: Sink = () => undefined

export function setBroadcastSink(fn: Sink): void {
  sink = fn
}

/** Send an event to every live renderer. Session channels are unique, so only the owner reacts. */
export function broadcast(channel: string, ...args: unknown[]): void {
  sink(channel, args)
}
