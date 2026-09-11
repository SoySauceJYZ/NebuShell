// Docker 面板的命令与解析(仿 systemMonitor.ts 的「命令 + 解析器」形态)。
//
// 所有命令都经 window.api.ssh.execFull 下发 —— 它带回 stderr 与退出码,所以这里
// 不再拼 `2>&1`、也不靠输出内容猜成败:exit!==0 即失败,stderr 即原因。
// 输出一律用 --format 指定为制表符分隔,列数固定,避免解析空格对齐的表格。

export type ContainerState =
  'running' | 'exited' | 'paused' | 'created' | 'restarting' | 'dead' | 'unknown'

export type HealthState = 'healthy' | 'unhealthy' | 'starting'

export interface ContainerInfo {
  id: string
  name: string
  image: string
  state: ContainerState
  status: string
  ports: string
  /** 健康检查状态(镜像声明了 HEALTHCHECK 才有)。 */
  health?: HealthState
  /** compose 项目名与服务名(来自 com.docker.compose.* 标签)。 */
  project?: string
  service?: string
}

/** docker stats 的一行(仅运行中的容器有)。 */
export interface ContainerStat {
  cpu: string
  mem: string
  memPerc: string
  net: string
  block: string
}

export interface ImageInfo {
  id: string
  repository: string
  tag: string
  size: string
  created: string
  /** 悬空镜像(<none>:<none>),prune 的主要回收对象。 */
  dangling: boolean
}

export interface VolumeInfo {
  name: string
  driver: string
  mountpoint: string
}

export interface NetworkInfo {
  id: string
  name: string
  driver: string
  scope: string
  /** docker 内置网络(bridge/host/none)不可删除。 */
  builtin: boolean
}

/** docker system df 的一行。 */
export interface DiskUsageRow {
  type: string
  total: string
  active: string
  size: string
  reclaimable: string
}

/** 容器的一条端口映射(只保留对外发布的)。 */
export interface PortMapping {
  hostIp: string
  hostPort: string
  containerPort: string
  proto: string
}

/** docker inspect 拿到的挂载点。 */
export interface MountInfo {
  type: string
  /** 宿主机上的路径(bind 是原路径,volume 是 /var/lib/docker/volumes/...)。 */
  source: string
  destination: string
  rw: boolean
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

// ---- 容器列表 --------------------------------------------------------------

export function buildPsCommand(dockerCmd: string): string {
  return (
    `${dockerCmd} ps -a --no-trunc --format ` +
    `'{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Labels}}'`
  )
}

const STATES = new Set<ContainerState>([
  'running',
  'exited',
  'paused',
  'created',
  'restarting',
  'dead'
])

/** 从 Status 文本推断状态(老版本 docker 无 {{.State}} 时的兜底)。 */
function stateFromStatus(status: string): ContainerState {
  const s = status.toLowerCase()
  if (s.includes('paused')) return 'paused'
  if (s.startsWith('up')) return 'running'
  if (s.startsWith('exited')) return 'exited'
  if (s.startsWith('created')) return 'created'
  if (s.startsWith('restarting')) return 'restarting'
  if (s.startsWith('dead')) return 'dead'
  return 'unknown'
}

/** Status 里的 '(healthy)' / '(unhealthy)' / '(health: starting)'。 */
function healthFromStatus(status: string): HealthState | undefined {
  const s = status.toLowerCase()
  if (s.includes('(healthy)')) return 'healthy'
  if (s.includes('(unhealthy)')) return 'unhealthy'
  if (s.includes('health: starting')) return 'starting'
  return undefined
}

/** '{{.Labels}}' 是 'k=v,k=v' 形式;只取我们关心的几个键。 */
function labelValue(labels: string, key: string): string | undefined {
  for (const pair of labels.split(',')) {
    const i = pair.indexOf('=')
    if (i > 0 && pair.slice(0, i).trim() === key) return pair.slice(i + 1).trim() || undefined
  }
  return undefined
}

/** 解析 ps 输出。列数不足的行直接跳过(成败由退出码判定,不再靠格式猜)。 */
export function parsePsOutput(out: string): ContainerInfo[] {
  const items: ContainerInfo[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    if (f.length < 5) continue
    const rawState = (f[3] ?? '').toLowerCase() as ContainerState
    const status = f[4] ?? ''
    const labels = f[6] ?? ''
    items.push({
      id: f[0],
      name: f[1] ?? '',
      image: f[2] ?? '',
      state: STATES.has(rawState) ? rawState : stateFromStatus(status),
      status,
      ports: f[5] ?? '',
      health: healthFromStatus(status),
      project: labelValue(labels, 'com.docker.compose.project'),
      service: labelValue(labels, 'com.docker.compose.service')
    })
  }
  return items
}

// ---- 资源占用(docker stats) -----------------------------------------------

export function buildStatsCommand(dockerCmd: string): string {
  return (
    `${dockerCmd} stats --no-stream --format ` +
    `'{{.ID}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.NetIO}}\\t{{.BlockIO}}'`
  )
}

/** 按容器短 id(12 位)索引 —— stats 即使加 --no-trunc 也只给短 id。 */
export function parseStatsOutput(out: string): Record<string, ContainerStat> {
  const map: Record<string, ContainerStat> = {}
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    if (f.length < 4) continue
    map[f[0].trim().slice(0, 12)] = {
      cpu: (f[1] ?? '').trim(),
      mem: (f[2] ?? '').trim(),
      memPerc: (f[3] ?? '').trim(),
      net: (f[4] ?? '').trim(),
      block: (f[5] ?? '').trim()
    }
  }
  return map
}

// ---- 镜像 / 卷 / 网络 / 磁盘占用 -------------------------------------------

export function buildImagesCommand(dockerCmd: string): string {
  return (
    `${dockerCmd} images --format ` +
    `'{{.ID}}\\t{{.Repository}}\\t{{.Tag}}\\t{{.Size}}\\t{{.CreatedSince}}'`
  )
}

export function parseImagesOutput(out: string): ImageInfo[] {
  const items: ImageInfo[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    if (f.length < 4) continue
    const repository = f[1] ?? ''
    const tag = f[2] ?? ''
    items.push({
      id: f[0],
      repository,
      tag,
      size: f[3] ?? '',
      created: f[4] ?? '',
      dangling: repository === '<none>' || tag === '<none>'
    })
  }
  return items
}

export function buildVolumesCommand(dockerCmd: string): string {
  return `${dockerCmd} volume ls --format '{{.Name}}\\t{{.Driver}}\\t{{.Mountpoint}}'`
}

export function parseVolumesOutput(out: string): VolumeInfo[] {
  const items: VolumeInfo[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    if (!f[0]) continue
    items.push({ name: f[0], driver: f[1] ?? '', mountpoint: f[2] ?? '' })
  }
  return items
}

export function buildNetworksCommand(dockerCmd: string): string {
  return `${dockerCmd} network ls --format '{{.ID}}\\t{{.Name}}\\t{{.Driver}}\\t{{.Scope}}'`
}

const BUILTIN_NETWORKS = new Set(['bridge', 'host', 'none'])

export function parseNetworksOutput(out: string): NetworkInfo[] {
  const items: NetworkInfo[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    if (!f[0]) continue
    const name = f[1] ?? ''
    items.push({
      id: f[0],
      name,
      driver: f[2] ?? '',
      scope: f[3] ?? '',
      builtin: BUILTIN_NETWORKS.has(name)
    })
  }
  return items
}

export function buildDiskUsageCommand(dockerCmd: string): string {
  return (
    `${dockerCmd} system df --format ` +
    `'{{.Type}}\\t{{.TotalCount}}\\t{{.Active}}\\t{{.Size}}\\t{{.Reclaimable}}'`
  )
}

export function parseDiskUsageOutput(out: string): DiskUsageRow[] {
  const rows: DiskUsageRow[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    if (f.length < 5) continue
    rows.push({
      type: f[0],
      total: f[1],
      active: f[2],
      size: f[3],
      reclaimable: f[4]
    })
  }
  return rows
}

/** 清理动作。-f 免交互确认(面板里已经弹过确认框了)。 */
export type PruneKind = 'container' | 'image' | 'imageAll' | 'volume' | 'network' | 'builder'

export function buildPruneCommand(dockerCmd: string, kind: PruneKind): string {
  switch (kind) {
    case 'container':
      return `${dockerCmd} container prune -f`
    case 'image':
      return `${dockerCmd} image prune -f`
    case 'imageAll':
      return `${dockerCmd} image prune -a -f`
    case 'volume':
      return `${dockerCmd} volume prune -f`
    case 'network':
      return `${dockerCmd} network prune -f`
    case 'builder':
      return `${dockerCmd} builder prune -f`
  }
}

export const PRUNE_LABEL: Record<PruneKind, { title: string; detail: string }> = {
  container: { title: '清理已停止的容器', detail: '删除所有处于停止状态的容器,不影响运行中的。' },
  image: { title: '清理悬空镜像', detail: '删除没有标签、也没有容器引用的镜像层。' },
  imageAll: {
    title: '清理所有未使用的镜像',
    detail: '删除任何没有容器在用的镜像(包括有标签的),下次用到需要重新拉取。'
  },
  volume: { title: '清理未使用的卷', detail: '删除没有任何容器引用的卷 —— 卷里的数据会一并丢失。' },
  network: { title: '清理未使用的网络', detail: '删除没有容器连接的自定义网络。' },
  builder: { title: '清理构建缓存', detail: '删除 buildkit 的构建缓存,通常能回收较多空间。' }
}

// ---- 容器/镜像/卷/网络 的单项操作 ------------------------------------------

export type ContainerVerb =
  'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill' | 'rm' | 'rmForce'

export function buildContainerActionCommand(
  dockerCmd: string,
  verb: ContainerVerb,
  containerId: string
): string {
  if (verb === 'rm') return `${dockerCmd} rm ${containerId}`
  if (verb === 'rmForce') return `${dockerCmd} rm -f ${containerId}`
  return `${dockerCmd} ${verb} ${containerId}`
}

export const CONTAINER_VERB_LABEL: Record<ContainerVerb, string> = {
  start: '启动',
  stop: '停止',
  restart: '重启',
  pause: '暂停',
  unpause: '恢复',
  kill: '强制终止',
  rm: '删除',
  rmForce: '强制删除'
}

export function buildImageRemoveCommand(
  dockerCmd: string,
  imageId: string,
  force: boolean
): string {
  return `${dockerCmd} rmi ${force ? '-f ' : ''}${imageId}`
}

export function buildVolumeRemoveCommand(dockerCmd: string, name: string): string {
  return `${dockerCmd} volume rm ${shellQuote(name)}`
}

export function buildNetworkRemoveCommand(dockerCmd: string, id: string): string {
  return `${dockerCmd} network rm ${id}`
}

// ---- inspect(挂载点) ------------------------------------------------------

/**
 * 注意:`docker inspect --format` **不会**把 `\t` / `\n` 当转义展开(ps / images /
 * network ls 那几个走 docker 的 formatter 包,会展开;inspect 不走)。所以这里不拼
 * 制表符模板,直接要 JSON 再解析 —— 路径里本来就可能有空格,JSON 也更稳。
 */
export function buildMountsCommand(dockerCmd: string, containerId: string): string {
  return `${dockerCmd} inspect --format '{{json .Mounts}}' ${containerId}`
}

interface RawMount {
  Type?: string
  Source?: string
  Destination?: string
  RW?: boolean
}

export function parseMountsOutput(out: string): MountInfo[] {
  const text = out.trim()
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return (raw as RawMount[])
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      type: m.Type ?? '',
      source: m.Source ?? '',
      destination: m.Destination ?? '',
      rw: m.RW !== false
    }))
}

/** 完整 inspect(只读展示用)。 */
export function buildInspectCommand(dockerCmd: string, containerId: string): string {
  return `${dockerCmd} inspect ${containerId}`
}

// ---- 端口 ------------------------------------------------------------------

/**
 * 解析 ps 的 Ports 列,只留「对外发布」的映射。
 * 形如 `0.0.0.0:8080->80/tcp, :::8080->80/tcp, 9000/tcp`:
 * 后者只是暴露未发布(不可从外部访问),丢弃;IPv4/IPv6 同端口去重。
 */
export function parsePorts(ports: string): PortMapping[] {
  const out: PortMapping[] = []
  const seen = new Set<string>()
  for (const raw of ports.split(',')) {
    const part = raw.trim()
    if (!part || !part.includes('->')) continue
    const m = part.match(/^(.*):(\d+)->(\d+)\/(\w+)$/)
    if (!m) continue
    const [, hostIp, hostPort, containerPort, proto] = m
    const key = `${hostPort}/${proto}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ hostIp, hostPort, containerPort, proto })
  }
  return out
}

/**
 * 端口映射 → 可在浏览器里打开的地址。
 * 监听地址是 0.0.0.0 / :: / 空 时用主机本身的地址;端口 443 用 https。
 */
export function portUrl(p: PortMapping, hostAddress: string): string | null {
  if (p.proto !== 'tcp') return null
  const bare = p.hostIp.replace(/^\[|\]$/g, '')
  const wildcard = bare === '' || bare === '0.0.0.0' || bare === '::' || bare === '*'
  let target = wildcard ? hostAddress : bare
  if (target.includes(':') && !target.startsWith('[')) target = `[${target}]` // IPv6
  const scheme = p.hostPort === '443' || p.containerPort === '443' ? 'https' : 'http'
  return `${scheme}://${target}:${p.hostPort}`
}

// ---- 容器终端 --------------------------------------------------------------

export interface ExecShellOptions {
  /** 以该用户进入(docker exec -u),留空即镜像默认用户。 */
  user?: string
  /** 进入后的工作目录(docker exec -w)。 */
  workdir?: string
  /** 指定 shell;留空则 bash 优先、回退 sh。 */
  shell?: string
}

/** 为 shell 安全地单引号包裹参数。 */
function shellQuote(v: string): string {
  return /^[\w@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`
}

/** 容器终端的 exec 命令:默认 bash 优先、回退 sh;可指定 user / workdir / shell。 */
export function buildExecShellCommand(
  dockerCmd: string,
  containerId: string,
  opts: ExecShellOptions = {}
): string {
  const flags = ['-it']
  if (opts.user) flags.push('-u', shellQuote(opts.user))
  if (opts.workdir) flags.push('-w', shellQuote(opts.workdir))
  const shell = opts.shell?.trim()
  const entry = shell
    ? shellQuote(shell)
    : `sh -c 'command -v bash >/dev/null && exec bash || exec sh'`
  return `${dockerCmd} exec ${flags.join(' ')} ${containerId} ${entry}`
}

// ---- 日志 ------------------------------------------------------------------

export interface LogOptions {
  /** 末尾行数;'all' 表示不限。 */
  tail: number | 'all'
  timestamps?: boolean
  /** 只看这段时间以来的日志,如 '10m'、'2h'、'2026-09-11T00:00:00'。 */
  since?: string
  /** 持续跟随(用于终端 tab,编辑器快照不用)。 */
  follow?: boolean
}

export const LOG_TAIL_CHOICES: Array<{ value: number | 'all'; label: string }> = [
  { value: 200, label: '200 行' },
  { value: 1000, label: '1000 行' },
  { value: 5000, label: '5000 行' },
  { value: 'all', label: '全部' }
]

export function buildLogsCommand(dockerCmd: string, target: string, opts: LogOptions): string {
  const parts = [dockerCmd, 'logs']
  if (opts.follow) parts.push('-f')
  if (opts.timestamps) parts.push('-t')
  if (opts.since) parts.push('--since', shellQuote(opts.since))
  parts.push('--tail', String(opts.tail))
  parts.push(shellQuote(target))
  // 日志本身走 stderr 的情况很常见(nginx 等),快照模式要把两条流都收进来。
  return opts.follow ? parts.join(' ') : `${parts.join(' ')} 2>&1`
}

/** 容器名可能含 shell 元字符,不安全时退回容器 id。 */
export function logTarget(c: ContainerInfo): string {
  return /^[\w][\w.-]*$/.test(c.name) ? c.name : c.id
}
