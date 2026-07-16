import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { containerFsManager } from '../docker/ContainerFsManager'
import type { ContainerFsConnectOptions, TransferProgress } from '../../shared/types'

/** 把 TransferProgress 转发给渲染进程(通道族与 sftp:/local: 并列)。 */
function progressForwarder(sender: WebContents, transferId: string) {
  return (p: Omit<TransferProgress, 'transferId'>): void => {
    if (sender.isDestroyed()) return
    sender.send(`containerFs:progress:${transferId}`, { transferId, ...p })
  }
}

export function registerContainerFsIpc(): void {
  ipcMain.handle('containerFs:connect', async (_e, opts: ContainerFsConnectOptions) => {
    await containerFsManager.connect(opts)
  })

  ipcMain.handle('containerFs:list', (_e, sessionId: string, path: string) =>
    containerFsManager.list(sessionId, path)
  )

  ipcMain.handle('containerFs:readFile', (_e, sessionId: string, path: string) =>
    containerFsManager.readFile(sessionId, path)
  )

  ipcMain.handle(
    'containerFs:writeFile',
    (_e, sessionId: string, path: string, content: string) =>
      containerFsManager.writeFile(sessionId, path, content)
  )

  ipcMain.handle('containerFs:mkdir', (_e, sessionId: string, path: string) =>
    containerFsManager.mkdir(sessionId, path)
  )

  ipcMain.handle(
    'containerFs:rename',
    (_e, sessionId: string, oldPath: string, newPath: string) =>
      containerFsManager.rename(sessionId, oldPath, newPath)
  )

  ipcMain.handle(
    'containerFs:remove',
    (_e, sessionId: string, path: string, isDirectory: boolean) =>
      containerFsManager.remove(sessionId, path, isDirectory)
  )

  ipcMain.handle(
    'containerFs:uploadPaths',
    async (
      e,
      sessionId: string,
      containerDir: string,
      localPaths: string[],
      transferId: string
    ) => {
      const onProgress = progressForwarder(e.sender, transferId)
      try {
        await containerFsManager.uploadPaths(sessionId, containerDir, localPaths, onProgress)
      } catch (err) {
        onProgress({
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
          doneBytes: 0,
          totalBytes: 0,
          doneFiles: 0,
          totalFiles: 0
        })
        throw err
      }
    }
  )

  ipcMain.handle(
    'containerFs:downloadTo',
    async (e, sessionId: string, containerPath: string, localDir: string, transferId: string) => {
      const onProgress = progressForwarder(e.sender, transferId)
      try {
        await containerFsManager.downloadTo(sessionId, containerPath, localDir, onProgress)
      } catch (err) {
        onProgress({
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
          doneBytes: 0,
          totalBytes: 0,
          doneFiles: 0,
          totalFiles: 0
        })
        throw err
      }
    }
  )

  ipcMain.handle('containerFs:disconnect', (_e, sessionId: string) =>
    containerFsManager.disconnect(sessionId)
  )
}
