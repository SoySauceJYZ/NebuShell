import { ipcMain, shell, app } from 'electron'
import { checkForUpdate, getCachedUpdate } from '../update/UpdateChecker'
import { settingsManager } from '../settings/SettingsManager'
import { broadcast } from '../windows'

// 启动后稍等再查,别和首屏的连接/解锁抢网络。
const AUTO_CHECK_DELAY_MS = 5000

// 下载链接只允许指向 GitHub,避免渲染进程被诱导用系统浏览器打开任意外链。
const ALLOWED_HOSTS = ['github.com', 'www.github.com', 'objects.githubusercontent.com']

export function registerUpdateIpc(): void {
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:getCached', () => getCachedUpdate())
  ipcMain.handle('update:currentVersion', () => app.getVersion())

  ipcMain.handle('update:openDownload', async (_e, url: string) => {
    const host = new URL(url).hostname
    if (!ALLOWED_HOSTS.includes(host) && !host.endsWith('.githubusercontent.com')) {
      throw new Error('拒绝打开非 GitHub 链接')
    }
    await shell.openExternal(url)
  })

  if (settingsManager.get().autoCheckUpdate) {
    setTimeout(() => {
      void checkForUpdate()
        .then((info) => {
          if (info.hasUpdate) broadcast('update:available', info)
        })
        // 启动时的自动检查失败保持静默,用户可以在设置页手动重试。
        .catch(() => undefined)
    }, AUTO_CHECK_DELAY_MS)
  }
}
