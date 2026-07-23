import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createAppWindow } from './windows'
import { registerVaultIpc } from './ipc/vaultIpc'
import { registerSshIpc } from './ipc/sshIpc'
import { registerSftpIpc } from './ipc/sftpIpc'
import { registerContainerFsIpc } from './ipc/containerFsIpc'
import { registerLocalIpc } from './ipc/localIpc'
import { registerWindowIpc } from './ipc/windowIpc'
import { registerFileIpc } from './ipc/fileIpc'
import { registerHistoryIpc } from './ipc/historyIpc'
import { registerLlmIpc } from './ipc/llmIpc'
import { registerAgentChatIpc } from './ipc/agentChatIpc'
import { registerCommandHistoryIpc } from './ipc/commandHistoryIpc'
import { registerQuickCommandsIpc } from './ipc/quickCommandsIpc'
import { registerSettingsIpc } from './ipc/settingsIpc'

// Window creation lives in ./windows so both the initial window and torn-off tab
// windows go through the same path (and get registered for broadcast/hit-testing).

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.nebuwork.nebushell')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerVaultIpc()
  registerSshIpc()
  registerSftpIpc()
  registerContainerFsIpc()
  registerLocalIpc()
  registerWindowIpc()
  registerFileIpc()
  registerHistoryIpc()
  registerLlmIpc()
  registerAgentChatIpc()
  registerCommandHistoryIpc()
  registerQuickCommandsIpc()
  registerSettingsIpc()

  createAppWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createAppWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
