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
