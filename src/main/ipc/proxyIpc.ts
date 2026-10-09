import { ipcMain } from 'electron'
import { vaultManager } from '../vault/VaultManager'
import { checkLocal, checkRemote } from '../proxy/ProxyChecker'
import { listVaultHosts } from '../mcp/McpSshPool'
import { PROXY_LOCAL_KEY, type ProxyCheckResult, type ProxyEntry } from '../../shared/types'

type NewProxy = Omit<ProxyEntry, 'id' | 'createdAt'>

export function registerProxyIpc(): void {
  ipcMain.handle('proxy:add', (_e, items: NewProxy[]): ProxyEntry[] =>
    vaultManager.addProxies(Array.isArray(items) ? items : [])
  )

  ipcMain.handle('proxy:update', (_e, id: string, patch: Partial<ProxyEntry>) =>
    vaultManager.updateProxy(id, patch)
  )

  ipcMain.handle('proxy:delete', (_e, ids: string[]) => vaultManager.deleteProxies(ids))

  /**
   * 检测一个代理。targetKey = 'local' 在本机检测,否则为主机 id、在该主机上经 curl 检测。
   * 代理按 id 从 vault 取,渲染端不必传密码;结果落库后返回。
   */
  ipcMain.handle(
    'proxy:check',
    async (_e, id: string, targetKey: string, probeUrl?: string): Promise<ProxyCheckResult> => {
      const proxy = vaultManager.getProxy(id)
      const probe = probeUrl && /^https?:\/\/[^\s'"]+$/i.test(probeUrl) ? probeUrl : undefined
      let result: ProxyCheckResult
      try {
        if (targetKey === PROXY_LOCAL_KEY) {
          result = await checkLocal(proxy, probe)
        } else {
          const host = listVaultHosts().find((h) => h.id === targetKey)
          if (!host) throw new Error('检测主机不存在(可能已被删除)')
          result = await checkRemote(host, proxy, probe)
        }
      } catch (e) {
        result = {
          ok: false,
          checkedAt: Date.now(),
          error: e instanceof Error ? e.message : String(e)
        }
      }
      vaultManager.setProxyCheck(id, targetKey, result)
      return result
    }
  )
}
