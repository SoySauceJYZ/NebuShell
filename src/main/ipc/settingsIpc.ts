import { ipcMain } from 'electron'
import { settingsManager } from '../settings/SettingsManager'
import { sftpManager } from '../sftp/SftpManager'
import { mcpManager } from '../mcp/McpManager'
import type { AppSettings, McpStatus } from '../../shared/types'

/** Push persisted settings into the live managers that consume them. */
async function applySettings(settings: AppSettings, prev?: AppSettings): Promise<void> {
  sftpManager.setConcurrency(settings.transferConcurrency)
  const running = mcpManager.status().running
  // 端口变更需要重启监听才能生效。
  if (running && (!settings.mcpEnabled || (prev && prev.mcpPort !== settings.mcpPort))) {
    await mcpManager.stop()
  }
  if (settings.mcpEnabled && !mcpManager.status().running) await mcpManager.start()
}

export function registerSettingsIpc(): void {
  // Apply persisted values on startup so a saved concurrency takes effect immediately.
  void applySettings(settingsManager.get())

  ipcMain.handle('settings:get', () => settingsManager.get())

  ipcMain.handle(
    'settings:set',
    async (_e, patch: Partial<AppSettings>): Promise<AppSettings & { mcpStatus: McpStatus }> => {
      const prev = settingsManager.get()
      const next = settingsManager.update(patch)
      await applySettings(next, prev)
      // 开启时 start() 可能刚生成了令牌,以持久化后的值为准。
      return { ...settingsManager.get(), mcpStatus: mcpManager.status() }
    }
  )
}
