import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import { vaultManager } from '../vault/VaultManager'
import type { Host, Group, Credential, VaultImportResult } from '../../shared/types'

export function registerVaultIpc(): void {
  ipcMain.handle('vault:isInitialized', () => vaultManager.isInitialized())
  ipcMain.handle('vault:isUnlocked', () => vaultManager.isUnlocked())

  ipcMain.handle('vault:create', (_e, masterPassword: string) => {
    vaultManager.create(masterPassword)
    return vaultManager.getData()
  })

  ipcMain.handle('vault:unlock', (_e, masterPassword: string) => {
    vaultManager.unlock(masterPassword)
    return vaultManager.getData()
  })

  ipcMain.handle('vault:lock', () => {
    vaultManager.lock()
  })

  ipcMain.handle('vault:getData', () => vaultManager.getData())

  ipcMain.handle('vault:host:add', (_e, host: Omit<Host, 'id'>) => vaultManager.addHost(host))
  ipcMain.handle('vault:host:update', (_e, id: string, patch: Partial<Host>) =>
    vaultManager.updateHost(id, patch)
  )
  ipcMain.handle('vault:host:delete', (_e, id: string) => vaultManager.deleteHost(id))

  ipcMain.handle('vault:group:add', (_e, group: Omit<Group, 'id'>) => vaultManager.addGroup(group))
  ipcMain.handle('vault:group:update', (_e, id: string, patch: Partial<Group>) =>
    vaultManager.updateGroup(id, patch)
  )
  ipcMain.handle('vault:group:delete', (_e, id: string) => vaultManager.deleteGroup(id))

  ipcMain.handle('vault:credential:add', (_e, cred: Omit<Credential, 'id'>) =>
    vaultManager.addCredential(cred)
  )
  ipcMain.handle('vault:credential:update', (_e, id: string, patch: Partial<Credential>) =>
    vaultManager.updateCredential(id, patch)
  )
  ipcMain.handle('vault:credential:delete', (_e, id: string) => vaultManager.deleteCredential(id))

  // Export: build an encrypted file and let the user choose where to save it.
  ipcMain.handle('vault:export', async (e, password: string): Promise<string | null> => {
    const json = vaultManager.exportEncrypted(password)
    const win = BrowserWindow.fromWebContents(e.sender)
    const stamp = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(win as BrowserWindow, {
      defaultPath: `ssh-vault-export-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, json, 'utf8')
    return result.filePath
  })

  // Import step 1: pick a file and return its raw contents (decryption happens
  // in step 2 so a wrong password doesn't force re-picking the file).
  ipcMain.handle('vault:import:pickFile', async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return readFileSync(result.filePaths[0], 'utf8')
  })

  // Import step 2: decrypt the picked file with the password and merge.
  ipcMain.handle('vault:import:apply', (_e, password: string, content: string): VaultImportResult =>
    vaultManager.importEncrypted(password, content)
  )
}
