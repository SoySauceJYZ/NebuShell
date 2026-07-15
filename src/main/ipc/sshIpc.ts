import { ipcMain } from 'electron'
import { sshManager } from '../ssh/SshManager'
import type { SshConnectOptions } from '../../shared/types'

export function registerSshIpc(): void {
  ipcMain.handle('ssh:connect', async (_e, opts: SshConnectOptions) => {
    await sshManager.connect(opts)
  })

  // Return a session's buffered scrollback so a window adopting a torn-off tab can
  // rebuild its terminal without reconnecting.
  ipcMain.handle('ssh:replay', (_e, sessionId: string) => sshManager.replay(sessionId))

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
