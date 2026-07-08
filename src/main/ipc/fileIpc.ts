import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'

export function registerFileIpc(): void {
  ipcMain.handle(
    'file:saveText',
    async (e, defaultName: string, content: string): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showSaveDialog(win as BrowserWindow, {
        defaultPath: defaultName || 'untitled.txt'
      })
      if (result.canceled || !result.filePath) return null
      writeFileSync(result.filePath, content, 'utf8')
      return result.filePath
    }
  )

  ipcMain.handle(
    'dialog:confirm',
    async (
      e,
      opts: { message: string; detail?: string; confirmLabel?: string; cancelLabel?: string }
    ): Promise<boolean> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showMessageBox(win as BrowserWindow, {
        type: 'question',
        message: opts.message,
        detail: opts.detail,
        buttons: [opts.confirmLabel ?? '是', opts.cancelLabel ?? '否'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      return result.response === 0
    }
  )
}
