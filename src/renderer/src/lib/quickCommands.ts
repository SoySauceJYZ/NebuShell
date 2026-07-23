import type { Host, QuickCommand } from '@shared/types'
import type { Tab } from '../store/useSessionStore'

/**
 * Normalize a saved multi-line command block into terminal-ready input:
 * CRLF/CR → LF, drop trailing blank lines, then append a single newline so the last
 * command also executes when written to the PTY (the shell runs it line by line).
 */
export function buildBatch(commands: string): string {
  const normalized = commands.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.replace(/\n+$/, '')
  return trimmed ? trimmed + '\n' : ''
}

export interface RunQuickCommandContext {
  /** The currently active terminal session (used for non-bound commands). */
  sessionId: string
  openTab: (tab: Tab) => void
  hosts: Host[]
}

/**
 * Shared click behavior for both the sidebar panel and the command palette:
 * - bound to a server → open a NEW terminal tab, connect it, and run once on connect.
 * - not bound         → write the batch into the current active terminal and execute.
 */
export function runQuickCommand(cmd: QuickCommand, ctx: RunQuickCommandContext): void {
  const batch = buildBatch(cmd.commands)
  if (!batch) return
  if (cmd.hostId) {
    const host = ctx.hosts.find((h) => h.id === cmd.hostId)
    if (!host) {
      window.alert('该快捷命令绑定的服务器已不存在,请编辑后重新选择。')
      return
    }
    ctx.openTab({
      id: `terminal-${host.id}-${Date.now()}`,
      kind: 'terminal',
      title: host.label,
      hostId: host.id,
      initialCommands: batch
    })
  } else {
    window.api.ssh.write(ctx.sessionId, batch)
  }
}
