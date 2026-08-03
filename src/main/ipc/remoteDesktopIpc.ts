import { ipcMain, desktopCapturer, screen, app, type Display } from 'electron'
import { promises as fsp } from 'fs'
import { existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { remoteDesktopManager } from '../remoteDesktop/RemoteDesktopManager'
import { inputInjector } from '../remoteDesktop/InputInjector'
import { broadcast } from '../windows'
import type { RdSignal, RdInputEvent, RdScreen } from '../../shared/types'

/** 把一块 Electron display 的边界换算成物理像素,配置给注入器。 */
function applyDisplayToInjector(d: Display): void {
  const sf = d.scaleFactor
  inputInjector.setActiveDisplay({
    x: Math.round(d.bounds.x * sf),
    y: Math.round(d.bounds.y * sf),
    width: Math.round(d.size.width * sf),
    height: Math.round(d.size.height * sf)
  })
}

export function registerRemoteDesktopIpc(): void {
  // 管理器事件 → 广播到渲染层。信令按 rdSessionId 走独立频道;控制端/被控端各自订阅。
  remoteDesktopManager.onSignal = (rdSessionId: string, signal: RdSignal): void => {
    broadcast(`rd:signal:${rdSessionId}`, signal)
  }
  // 被控端:有控制端接入,通知本机被控渲染层开始采屏/应答。
  remoteDesktopManager.onPeerConnect = (rdSessionId: string): void => {
    broadcast('rd:agentPeer', rdSessionId)
  }
  remoteDesktopManager.onPeerDisconnect = (rdSessionId: string): void => {
    broadcast(`rd:peerDisconnect:${rdSessionId}`, rdSessionId)
  }

  // ---- 被控端(agent) -------------------------------------------------------
  ipcMain.handle('rd:startAgent', async () => {
    const result = await remoteDesktopManager.startAgent()
    // 默认注入主屏;量一次分辨率兜底。
    applyDisplayToInjector(screen.getPrimaryDisplay())
    await inputInjector.refreshScreenSize()
    return result
  })
  ipcMain.handle('rd:stopAgent', () => {
    remoteDesktopManager.stopAgent()
  })
  ipcMain.handle('rd:agentStatus', () => remoteDesktopManager.agentStatus())

  // 被控端所有显示器(供控制端切换)。sourceId 用于采集,displayId 用于注入坐标换算。
  ipcMain.handle('rd:listScreens', async (): Promise<RdScreen[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    })
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id
    return sources.map((s, i) => {
      const d = displays.find((x) => String(x.id) === s.display_id)
      const sf = d?.scaleFactor ?? 1
      return {
        sourceId: s.id,
        displayId: d ? String(d.id) : s.display_id,
        name: d ? `显示器 ${displays.indexOf(d) + 1}` : s.name || `屏幕 ${i + 1}`,
        width: d ? Math.round(d.size.width * sf) : 0,
        height: d ? Math.round(d.size.height * sf) : 0,
        primary: d ? d.id === primaryId : false
      }
    })
  })

  // 切换被控显示器时同步注入坐标的目标显示器。
  ipcMain.handle('rd:setActiveDisplay', (_e, displayId: string) => {
    const d =
      screen.getAllDisplays().find((x) => String(x.id) === displayId) ??
      screen.getPrimaryDisplay()
    applyDisplayToInjector(d)
  })

  // 输入注入:高频事件(鼠标移动),用 send/on 单向直投,避免 invoke 往返延迟。
  ipcMain.on('rd:injectInput', (_e, ev: RdInputEvent) => {
    inputInjector.enqueue(ev)
  })

  // 接收控制端传来的文件,存到「下载」目录,返回落盘路径。
  ipcMain.handle('rd:saveFile', async (_e, name: string, data: ArrayBuffer): Promise<string> => {
    const dir = app.getPath('downloads')
    const target = dedupePath(join(dir, basename(name) || 'file'))
    await fsp.writeFile(target, Buffer.from(data))
    return target
  })

  // ---- 控制端(controller) --------------------------------------------------
  ipcMain.handle(
    'rd:connect',
    (_e, rdSessionId: string, opts: { ip: string; port: number; code: string }) =>
      remoteDesktopManager.connect(rdSessionId, opts)
  )
  ipcMain.handle('rd:disconnect', (_e, rdSessionId: string) => {
    remoteDesktopManager.disconnect(rdSessionId)
  })

  // ---- 共用信令 -------------------------------------------------------------
  ipcMain.handle('rd:sendSignal', (_e, rdSessionId: string, signal: RdSignal) => {
    remoteDesktopManager.sendSignal(rdSessionId, signal)
  })
}

/** 目标已存在时,在文件名后追加 (1)/(2)… 直到不冲突。 */
function dedupePath(p: string): string {
  if (!existsSync(p)) return p
  const ext = extname(p)
  const stem = p.slice(0, p.length - ext.length)
  let i = 1
  while (existsSync(`${stem} (${i})${ext}`)) i++
  return `${stem} (${i})${ext}`
}
