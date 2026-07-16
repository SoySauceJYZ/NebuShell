// Docker 容器列表/探测:命令与解析(仿 systemMonitor.ts 的「命令 + 解析器」形态)。
// 注意:window.api.ssh.exec 只返回 stdout(无 stderr / exit code),
// 因此所有命令都必须把状态以 marker 或 2>&1 的形式折进 stdout。

export interface ContainerInfo {
  id: string
  name: string
  image: string
  state: 'running' | 'exited' | 'paused' | 'created' | 'restarting' | 'dead' | 'unknown'
  status: string
  ports: string
}

/** 探测结果:可用的 docker 调用前缀,或不可用原因。 */
export type DockerProbeResult = 'docker' | 'sudo -n docker' | 'absent' | 'denied'

const MARK = 'NEB_DOCKER:'

/** 单次往返探测:docker 是否存在、当前用户直连或 sudo -n 是否可用。 */
export const PROBE_COMMAND =
  `command -v docker >/dev/null 2>&1 || { echo ${MARK}absent; exit 0; }; ` +
  `docker version --format x >/dev/null 2>&1 && { echo ${MARK}docker; exit 0; }; ` +
  `sudo -n docker version --format x >/dev/null 2>&1 && { echo ${MARK}sudo; exit 0; }; ` +
  `echo ${MARK}denied`

export function parseProbeOutput(out: string): DockerProbeResult {
  const m = out.match(/NEB_DOCKER:(\w+)/)
  switch (m?.[1]) {
    case 'docker':
      return 'docker'
    case 'sudo':
      return 'sudo -n docker'
    case 'absent':
      return 'absent'
    default:
      return 'denied'
  }
}

export function buildPsCommand(dockerCmd: string): string {
  return (
    `${dockerCmd} ps -a --no-trunc --format ` +
    `'{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Status}}\\t{{.Ports}}' 2>&1`
  )
}

const STATES = new Set(['running', 'exited', 'paused', 'created', 'restarting', 'dead'])

/** 从 Status 文本推断状态(老版本 docker 无 {{.State}} 时的兜底)。 */
function stateFromStatus(status: string): ContainerInfo['state'] {
  const s = status.toLowerCase()
  if (s.includes('paused')) return 'paused'
  if (s.startsWith('up')) return 'running'
  if (s.startsWith('exited')) return 'exited'
  if (s.startsWith('created')) return 'created'
  if (s.startsWith('restarting')) return 'restarting'
  if (s.startsWith('dead')) return 'dead'
  return 'unknown'
}

/** 解析 ps 输出。整体不像预期格式时抛错(此时输出内容即错误文本,如权限报错)。 */
export function parsePsOutput(out: string): ContainerInfo[] {
  const lines = out.split('\n').filter((l) => l.trim())
  const items: ContainerInfo[] = []
  for (const line of lines) {
    const f = line.split('\t')
    if (f.length < 5) {
      // 任何一行不含制表符分隔的 5+ 列 → 认为是错误输出
      throw new Error(out.trim().slice(0, 500) || 'docker ps 输出为空')
    }
    const rawState = (f[3] ?? '').toLowerCase()
    const status = f[4] ?? ''
    items.push({
      id: f[0],
      name: f[1] ?? '',
      image: f[2] ?? '',
      state: (STATES.has(rawState) ? rawState : stateFromStatus(status)) as ContainerInfo['state'],
      status,
      ports: f[5] ?? ''
    })
  }
  return items
}

/** 容器终端的 exec 命令:优先 bash,回退 sh。 */
export function buildExecShellCommand(dockerCmd: string, containerId: string): string {
  return `${dockerCmd} exec -it ${containerId} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`
}
