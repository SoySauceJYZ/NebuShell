/**
 * 关掉 SFTP 面板会断开 sftp 会话并卸载 RemotePane,再打开时它本来只会回到 '/'。
 * 这里按 session id 记住最后成功列出的目录,重开时优先回到那里(目录已不存在就退回 '/')。
 * 只存在内存里,随应用进程一起消失 —— 与其它 *BySession 面板状态的生命周期一致。
 */
const lastDir = new Map<string, string>()

export function rememberDir(sessionId: string, path: string): void {
  lastDir.set(sessionId, path)
}

/** 上次浏览到的目录;从未记录过时返回 undefined。 */
export function recallDir(sessionId: string): string | undefined {
  return lastDir.get(sessionId)
}

/** 此刻挂载着的远程面板 —— SFTP 与容器文件都算,侧边栏那份 + 各个文件浏览器里的。 */
export interface OpenPaneInfo {
  /** 面板所属的 tab(侧边栏面板就是那个终端 tab),用于排掉「自己这一页」。 */
  ownerId: string
  hostId: string
  /** 该面板当前所在目录。 */
  path: string
  /** 容器文件面板才有;缺省即普通 SFTP 面板。 */
  container?: { containerId: string; containerName: string; dockerCmd: string }
}
export interface OpenPane extends OpenPaneInfo {
  sessionId: string
}

const openPanes = new Map<string, OpenPaneInfo>()

export function registerPane(sessionId: string, info: OpenPaneInfo): void {
  openPanes.set(sessionId, info)
}

export function unregisterPane(sessionId: string): void {
  openPanes.delete(sessionId)
}

/** 快照,按登记顺序。调用方自行过滤(比如排掉自己那一页的面板)。 */
export function listOpenPanes(): OpenPane[] {
  return [...openPanes].map(([sessionId, info]) => ({ sessionId, ...info }))
}
