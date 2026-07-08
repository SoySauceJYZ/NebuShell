import { ipcMain, BrowserWindow } from 'electron'

export function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })

  ipcMain.handle('window:toggleMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return false
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
    return win.isMaximized()
  })

  ipcMain.handle('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })

  ipcMain.handle('window:isMaximized', (e) => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  })

  // Notify the renderer when maximize state changes so the restore/maximize icon updates.
  ipcMain.on('window:subscribeMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const send = (): void => {
      if (!win.isDestroyed()) e.sender.send('window:maximizeChanged', win.isMaximized())
    }
    win.on('maximize', send)
    win.on('unmaximize', send)
  })
}
