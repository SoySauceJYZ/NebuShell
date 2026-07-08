import { ipcMain, BrowserWindow } from 'electron'
import { sshManager } from '../ssh/SshManager'
import type { SshConnectOptions } from '../../shared/types'

export function registerSshIpc(): void {
  ipcMain.handle('ssh:connect', async (e, opts: SshConnectOptions) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('No window')
    await sshManager.connect(win, opts)
  })

  ipcMain.handle('ssh:write', (_e, sessionId: string, data: string) => {
    sshManager.write(sessionId, data)
  })

  ipcMain.handle('ssh:resize', (_e, sessionId: string, cols: number, rows: number) => {
    sshManager.resize(sessionId, cols, rows)
  })

  ipcMain.handle('ssh:exec', (_e, sessionId: string, command: string) => {
    return sshManager.exec(sessionId, command)
  })

  ipcMain.handle('ssh:runInShell', (_e, sessionId: string, command: string) => {
    return sshManager.runInShell(sessionId, command)
  })

  ipcMain.handle('ssh:disconnect', (_e, sessionId: string) => {
    sshManager.disconnect(sessionId)
  })
}
