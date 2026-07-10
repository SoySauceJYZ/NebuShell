import { ipcMain, app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { CommandHistoryEntry } from '../../shared/types'

const DIR = 'command-history'

// hostId is a vault UUID (filesystem-safe). Here it becomes a *filename*, so guard
// against traversal / path separators before touching disk.
function isSafeHostId(hostId: string): boolean {
  return !!hostId && !hostId.includes('/') && !hostId.includes('\\') && !hostId.includes('..')
}

function fileFor(hostId: string): string {
  return join(app.getPath('userData'), DIR, `${hostId}.json`)
}

function read(hostId: string): CommandHistoryEntry[] {
  const file = fileFor(hostId)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(hostId: string, entries: CommandHistoryEntry[]): void {
  const dir = join(app.getPath('userData'), DIR)
  mkdirSync(dir, { recursive: true })
  const file = fileFor(hostId)
  const tmp = `${file}.tmp`
  // write to a temp file then rename, so a crash mid-write can't corrupt the store.
  writeFileSync(tmp, JSON.stringify(entries), 'utf8')
  writeFileSync(file, readFileSync(tmp))
  try {
    unlinkSync(tmp)
  } catch {
    // best effort
  }
}

export function registerCommandHistoryIpc(): void {
  ipcMain.handle('cmdHistory:list', (_e, hostId: string): CommandHistoryEntry[] => {
    if (!isSafeHostId(hostId)) return []
    return read(hostId)
  })

  // Accepts a batch (the renderer debounces bursts of typing/agent commands into one call).
  // Read-modify-write is atomic here because the main process is single-threaded and fs is sync.
  ipcMain.handle('cmdHistory:append', (_e, hostId: string, incoming: CommandHistoryEntry[]) => {
    if (!isSafeHostId(hostId) || !Array.isArray(incoming) || incoming.length === 0) return
    const entries = read(hostId)
    for (const entry of incoming) {
      if (!entry || !entry.command) continue
      const last = entries[entries.length - 1]
      // skip consecutive duplicates (same command + source)
      if (last && last.command === entry.command && last.source === entry.source) continue
      entries.push(entry)
    }
    write(hostId, entries)
  })

  ipcMain.handle('cmdHistory:remove', (_e, hostId: string, id: string) => {
    if (!isSafeHostId(hostId)) return
    const entries = read(hostId).filter((e) => e.id !== id)
    write(hostId, entries)
  })

  ipcMain.handle('cmdHistory:clear', (_e, hostId: string) => {
    if (!isSafeHostId(hostId)) return
    const file = fileFor(hostId)
    if (existsSync(file)) unlinkSync(file)
  })
}
