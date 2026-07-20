import { ipcMain, dialog, BrowserWindow, app, nativeImage } from 'electron'
import { sftpManager } from '../sftp/SftpManager'
import type { SshConnectOptions, TransferProgress } from '../../shared/types'
import { basename, join } from 'path'
import { mkdirSync } from 'fs'
import type { WebContents } from 'electron'

// 1x1 transparent PNG — Electron's startDrag requires a non-empty icon.
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
)

/** Build a progress forwarder that streams TransferProgress to the renderer. */
function progressForwarder(sender: WebContents, transferId: string) {
  return (p: Omit<TransferProgress, 'transferId'>): void => {
    if (sender.isDestroyed()) return
    sender.send(`sftp:progress:${transferId}`, { transferId, ...p })
  }
}

export function registerSftpIpc(): void {
  ipcMain.handle('sftp:connect', async (_e, opts: SshConnectOptions) => {
    await sftpManager.connect(opts)
  })

  ipcMain.handle('sftp:list', async (_e, sessionId: string, remotePath: string) => {
    return sftpManager.list(sessionId, remotePath)
  })

  // Dry run for the agent's transfer confirmation card — scans only, moves nothing.
  ipcMain.handle('sftp:planPath', async (_e, sessionId: string, remotePath: string) => {
    return sftpManager.planPath(sessionId, remotePath)
  })

  ipcMain.handle('sftp:mkdir', async (_e, sessionId: string, remotePath: string) => {
    return sftpManager.mkdir(sessionId, remotePath)
  })

  ipcMain.handle('sftp:readFile', async (_e, sessionId: string, remotePath: string) => {
    return sftpManager.readFile(sessionId, remotePath)
  })

  ipcMain.handle(
    'sftp:writeFile',
    async (_e, sessionId: string, remotePath: string, content: string) => {
      return sftpManager.writeFile(sessionId, remotePath, content)
    }
  )

  ipcMain.handle(
    'sftp:rename',
    async (_e, sessionId: string, oldPath: string, newPath: string) => {
      return sftpManager.rename(sessionId, oldPath, newPath)
    }
  )

  ipcMain.handle(
    'sftp:remove',
    async (_e, sessionId: string, remotePath: string, isDirectory: boolean) => {
      return sftpManager.remove(sessionId, remotePath, isDirectory)
    }
  )

  ipcMain.handle(
    'sftp:download',
    async (e, sessionId: string, remotePath: string) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showSaveDialog(win as BrowserWindow, {
        defaultPath: basename(remotePath)
      })
      if (result.canceled || !result.filePath) return null
      await sftpManager.download(sessionId, remotePath, result.filePath)
      return result.filePath
    }
  )

  ipcMain.handle(
    'sftp:upload',
    async (e, sessionId: string, remoteDir: string) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const localPath = result.filePaths[0]
      const remotePath = join(remoteDir, basename(localPath)).replace(/\\/g, '/')
      await sftpManager.upload(sessionId, localPath, remotePath)
      return remotePath
    }
  )

  // --- Drag-and-drop / recursive transfers (explicit paths, with progress) ---

  ipcMain.handle(
    'sftp:uploadPaths',
    async (e, sessionId: string, remoteDir: string, localPaths: string[], transferId: string) => {
      const onProgress = progressForwarder(e.sender, transferId)
      for (const localPath of localPaths) {
        await sftpManager.uploadPath(sessionId, localPath, remoteDir, onProgress)
      }
    }
  )

  ipcMain.handle(
    'sftp:downloadTo',
    async (e, sessionId: string, remotePath: string, localDir: string, transferId: string) => {
      await sftpManager.downloadPath(
        sessionId,
        remotePath,
        localDir,
        progressForwarder(e.sender, transferId)
      )
    }
  )

  ipcMain.handle(
    'sftp:transfer',
    async (
      e,
      srcSessionId: string,
      srcPath: string,
      dstSessionId: string,
      dstDir: string,
      transferId: string
    ) => {
      await sftpManager.transferRemoteToRemote(
        srcSessionId,
        srcPath,
        dstSessionId,
        dstDir,
        progressForwarder(e.sender, transferId)
      )
    }
  )

  // Native drag-out to the OS file manager: materialize the remote file to a temp
  // path, then hand the OS drag off to Electron. Files only (dirs use "download to…").
  ipcMain.on('sftp:startDrag', async (e, sessionId: string, remotePath: string, name: string) => {
    try {
      const dir = join(app.getPath('temp'), 'nebushell-drag')
      mkdirSync(dir, { recursive: true })
      const tmpPath = join(dir, name)
      await sftpManager.download(sessionId, remotePath, tmpPath)
      if (!e.sender.isDestroyed()) {
        e.sender.startDrag({ file: tmpPath, icon: DRAG_ICON })
      }
    } catch {
      // Ignore drag-out failures (e.g. connection dropped mid-download).
    }
  })

  ipcMain.handle('sftp:disconnect', (_e, sessionId: string) => {
    sftpManager.disconnect(sessionId)
  })
}
