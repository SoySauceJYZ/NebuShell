import { ipcMain, BrowserWindow } from 'electron'
import type { AdoptPayload } from '../../shared/types'
import { createAppWindow, windowAtScreenPoint, setPendingAdopt, takePendingAdopt } from '../windows'

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

  // Tear a tab off into another window. If the drop point lands over an existing window,
  // hand the tab to it (re-dock); otherwise create a new window at the cursor and stash
  // the payload for the fresh renderer to pull once it has loaded.
  ipcMain.handle('window:detachTab', (e, payload: AdoptPayload) => {
    const from = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const cursor = payload.cursor
    const target = cursor ? windowAtScreenPoint(cursor.x, cursor.y, from) : null
    if (target) {
      target.webContents.send('window:adoptTab', payload)
      target.focus()
      return
    }
    const win = createAppWindow()
    if (cursor) win.setPosition(Math.round(cursor.x - 80), Math.round(cursor.y - 20))
    setPendingAdopt(win.webContents.id, payload)
  })

  // A freshly torn-off window pulls its pending tab once its renderer is ready.
  ipcMain.handle('window:takePendingAdopt', (e) => takePendingAdopt(e.sender.id))

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
