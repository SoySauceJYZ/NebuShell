/**
 * 容器面板各分区共用的上下文。命令一律经 ctx.run 下发 —— 它用 ssh:execFull 判定
 * 退出码、把 stderr 映射成中文写进面板,所以各处不必再各写一遍错误处理。
 */
export interface DockerCtx {
  /** 执行 docker 命令用的 SSH 会话(即这个终端 tab 的会话)。 */
  sessionId: string
  hostId: string
  /** 'docker' 或 'sudo -n docker'。 */
  dockerCmd: string
  hostLabel: string
  /** 主机地址,用于把端口映射拼成可点击的 URL。 */
  hostAddress: string
  /** 跑一条 docker 命令:成功返回 true;失败返回 false 并已把错误显示出来。 */
  run: (command: string) => Promise<boolean>
  /** 跑一条命令并取回 stdout(失败时返回 null,错误已显示)。 */
  query: (command: string) => Promise<string | null>
  /** 立刻重新拉一次容器列表。 */
  refresh: () => void
  /** 有动作正在执行(按钮禁用用)。 */
  busy: boolean
}
