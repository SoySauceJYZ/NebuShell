import { ipcMain } from 'electron'
import { monitorCenter } from '../monitorCenter/MonitorCenter'

export function registerMonitorCenterIpc(): void {
  // 采集租约:监控中心标签页打开期间持有,关闭或超时即停止采集。
  ipcMain.handle('monitorCenter:acquire', () => monitorCenter.acquire())
  ipcMain.handle('monitorCenter:renew', (_e, id: string) => monitorCenter.renew(String(id)))
  ipcMain.handle('monitorCenter:release', (_e, id: string) => monitorCenter.release(String(id)))

  ipcMain.handle('monitorCenter:state', () => monitorCenter.getState())
  ipcMain.handle('monitorCenter:devices', () => monitorCenter.getDevices())
  ipcMain.handle('monitorCenter:device', (_e, id: string) => monitorCenter.getDevice(String(id)))
  ipcMain.handle('monitorCenter:events', (_e, limit?: number) =>
    monitorCenter.getEvents(Number(limit) || 50)
  )
  ipcMain.handle('monitorCenter:services', () => monitorCenter.getServices())
  ipcMain.handle('monitorCenter:llm', () => monitorCenter.getLlm())
  ipcMain.handle('monitorCenter:totals', () => monitorCenter.getTotals())

  ipcMain.handle('monitorCenter:managed', () => monitorCenter.getManaged())
  ipcMain.handle('monitorCenter:setEnabled', (_e, id: string, enabled: boolean) =>
    monitorCenter.setHostEnabled(String(id), !!enabled)
  )
  ipcMain.handle('monitorCenter:setOrder', (_e, id: string, sortOrder: number) =>
    monitorCenter.setHostOrder(String(id), Number(sortOrder))
  )
  ipcMain.handle('monitorCenter:test', (_e, id: string) => monitorCenter.testHost(String(id)))

  ipcMain.handle('monitorCenter:topology', () => monitorCenter.getTopology())
  ipcMain.handle('monitorCenter:discover', (_e, hostIds?: string[]) =>
    monitorCenter.discover(Array.isArray(hostIds) ? hostIds.map(String) : undefined)
  )
  ipcMain.handle('monitorCenter:cancelDiscovery', () => monitorCenter.cancelDiscovery())
}
