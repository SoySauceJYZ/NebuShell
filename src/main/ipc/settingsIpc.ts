import { ipcMain } from 'electron'
import { settingsManager } from '../settings/SettingsManager'
import { sftpManager } from '../sftp/SftpManager'
import type { AppSettings } from '../../shared/types'

/** Push persisted settings into the live managers that consume them. */
function applySettings(settings: AppSettings): void {
  sftpManager.setConcurrency(settings.transferConcurrency)
}

export function registerSettingsIpc(): void {
  // Apply persisted values on startup so a saved concurrency takes effect immediately.
  applySettings(settingsManager.get())

  ipcMain.handle('settings:get', () => settingsManager.get())

  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const next = settingsManager.update(patch)
    applySettings(next)
    return next
  })
}
