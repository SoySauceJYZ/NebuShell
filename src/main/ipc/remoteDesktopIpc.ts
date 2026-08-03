import { ipcMain, desktopCapturer, screen } from 'electron'
import { remoteDesktopManager } from '../remoteDesktop/RemoteDesktopManager'
import { inputInjector } from '../remoteDesktop/InputInjector'
import { broadcast } from '../windows'
import type { RdSignal, RdInputEvent, RdScreenSource } from '../../shared/types'

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
    // 采屏注入前先量出主屏像素分辨率(归一化坐标还原用)。
    await inputInjector.refreshScreenSize()
    return result
  })
  ipcMain.handle('rd:stopAgent', () => {
    remoteDesktopManager.stopAgent()
  })
  ipcMain.handle('rd:agentStatus', () => remoteDesktopManager.agentStatus())

  // 被控端主屏采集源(供渲染层 getUserMedia 的 chromeMediaSourceId 使用)。
  ipcMain.handle('rd:getScreenSource', async (): Promise<RdScreenSource | null> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    })
    if (sources.length === 0) return null
    const primaryId = screen.getPrimaryDisplay().id
    const source = sources.find((s) => s.display_id === String(primaryId)) ?? sources[0]
    const d = screen.getPrimaryDisplay()
    return {
      id: source.id,
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor)
    }
  })

  // 输入注入:高频事件(鼠标移动),用 send/on 单向直投,避免 invoke 往返延迟。
  ipcMain.on('rd:injectInput', (_e, ev: RdInputEvent) => {
    inputInjector.enqueue(ev)
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
