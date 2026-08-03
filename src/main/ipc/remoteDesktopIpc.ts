import { ipcMain, desktopCapturer, screen, app, type Display } from 'electron'
import { promises as fsp } from 'fs'
import { existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { remoteDesktopManager } from '../remoteDesktop/RemoteDesktopManager'
import { inputInjector } from '../remoteDesktop/InputInjector'
import { remoteShell } from '../remoteDesktop/RemoteShell'
import { broadcast } from '../windows'
import type { RdSignal, RdInputEvent, RdScreen, RdShellOpts } from '../../shared/types'

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
    remoteShell.killAll()
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

  // 远程命令行:被控端起一个真实终端(node-pty / ConPTY),输出/退出经 sender 定向回该
  // 被控渲染层,再由它转发到控制端的 shell DataChannel。id 由被控渲染层生成。
  ipcMain.handle('rd:shellStart', (e, id: string, opts: RdShellOpts) => {
    const wc = e.sender
    remoteShell.start(
      id,
      opts,
      (data) => {
        if (!wc.isDestroyed()) wc.send(`rd:shellData:${id}`, data)
      },
      (code) => {
        if (!wc.isDestroyed()) wc.send(`rd:shellExit:${id}`, code)
      }
    )
  })
  ipcMain.on('rd:shellInput', (_e, id: string, data: string) => remoteShell.write(id, data))
  ipcMain.handle('rd:shellResize', (_e, id: string, cols: number, rows: number) =>
    remoteShell.resize(id, cols, rows)
  )
  ipcMain.handle('rd:shellKill', (_e, id: string) => remoteShell.kill(id))

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
