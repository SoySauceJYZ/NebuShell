import { ipcMain, shell } from 'electron'
import { mcpManager } from '../mcp/McpManager'
import { auditLogPath } from '../mcp/audit'
import { settingsManager } from '../settings/SettingsManager'

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:status', () => mcpManager.status())

  ipcMain.handle('mcp:regenToken', () => {
    return settingsManager.update({ mcpToken: mcpManager.generateToken() }).mcpToken
  })

  ipcMain.handle('mcp:showAuditLog', () => {
    shell.showItemInFolder(auditLogPath())
  })
}
