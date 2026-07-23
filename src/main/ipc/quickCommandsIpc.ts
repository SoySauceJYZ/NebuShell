import { ipcMain, app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { QuickCommand } from '../../shared/types'

// Non-sensitive user-defined quick commands, stored as a single JSON array outside the
// vault (same rationale as command history). Whole-array read/write keeps it simple.
const FILE = 'quick-commands.json'

function filePath(): string {
  return join(app.getPath('userData'), FILE)
}

function read(): QuickCommand[] {
  const file = filePath()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(items: QuickCommand[]): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const file = filePath()
  const tmp = `${file}.tmp`
  // write to a temp file then copy over, so a crash mid-write can't corrupt the store.
  writeFileSync(tmp, JSON.stringify(items), 'utf8')
  writeFileSync(file, readFileSync(tmp))
  try {
    unlinkSync(tmp)
  } catch {
    // best effort
  }
}

export function registerQuickCommandsIpc(): void {
  ipcMain.handle('quickCommands:list', (): QuickCommand[] => read())

  ipcMain.handle('quickCommands:save', (_e, items: QuickCommand[]) => {
    if (!Array.isArray(items)) return
    write(items)
  })
}
