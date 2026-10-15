// Docker 容器只读采集,移植自 resource-monitor 的 collectDocker;无权限时回退 sudo -n docker。
import type { Host } from '../../../shared/types'
import { execOk, num, safeError } from '../util'

const TIMEOUT_MS = 10000
const OUTPUT_LIMIT = 2 * 1024 * 1024
const MAX_CONTAINERS = 200

// 先试普通用户,再试免密 sudo;输出 __RM_DOCKER__<cmd> 告知后续命令前缀。
const CHECK_COMMAND = String.raw`command -v docker >/dev/null 2>&1 || { printf '__RM_DOCKER_NOT_INSTALLED__\n'; exit 0; }; if v=$(docker version --format '{{.Server.Version}}' 2>&1); then printf '__RM_DOCKER__docker\n%s\n' "$v"; elif sudo -n docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then printf '__RM_DOCKER__sudo\n'; sudo -n docker version --format '{{.Server.Version}}' 2>&1; else printf '%s\n' "$v"; exit 1; fi`
const PS = String.raw`ps -a --no-trunc --format '{{json .}}' 2>&1`
const STATS = String.raw`stats --no-stream --format '{{json .}}' 2>&1`
const inspectCommand = (d: string): string =>
  String.raw`ids=$(${d} ps -aq --no-trunc | head -200); if [ -n "$ids" ]; then ${d} inspect --format '{"Id":{{json .Id}},"RestartCount":{{json .RestartCount}},"Status":{{json .State.Status}},"ComposeProject":{{json (index .Config.Labels "com.docker.compose.project")}},"ComposeService":{{json (index .Config.Labels "com.docker.compose.service")}}}' $ids 2>&1; fi`

export type DockerStatus =
  | 'available'
  | 'pending'
  | 'not_installed'
  | 'permission_denied'
  | 'daemon_unavailable'
  | 'unreachable'
  | 'auth_failed'
  | 'error'

export interface DockerContainer {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  createdAt: string
  health: string
  restartCount: number
  composeProject: string
  composeService: string
  cpuPercent: number | null
  memoryUsage: string
  memoryUsedBytes: number | null
  memoryPercent: number | null
  networkIO: string
  blockIO: string
  pids: number | null
}

export interface DockerState {
  status: DockerStatus
  version: string | null
  lastCollectedAt: number | null
  error: string | null
  containers: DockerContainer[]
}

export const emptyDocker = (): DockerState => ({
  status: 'pending',
  version: null,
  lastCollectedAt: null,
  error: null,
  containers: []
})

function failureStatus(error: unknown): DockerStatus {
  const message = safeError(error)
  if (/permission denied|got permission denied|access denied/i.test(message))
    return 'permission_denied'
  if (
    /cannot connect to the docker daemon|is the docker daemon running|error during connect|docker daemon is not running/i.test(
      message
    )
  )
    return 'daemon_unavailable'
  return 'error'
}

function parseLines(output: string, limit = MAX_CONTAINERS): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      throw new Error('Docker JSON 输出解析失败')
    }
    if (rows.length >= limit) break
  }
  return rows
}

const dockerState = (v: unknown): string => {
  const s = String(v || '')
    .trim()
    .toLowerCase()
  return ['running', 'exited', 'restarting', 'paused', 'created', 'dead'].includes(s)
    ? s
    : 'unknown'
}
const dockerHealth = (v: unknown): string => {
  const h = String(v || '')
    .trim()
    .toLowerCase()
  return ['healthy', 'unhealthy', 'starting'].includes(h) ? h : 'none'
}
const parsePercent = (v: unknown): number | null =>
  num(
    String(v ?? '')
      .replace('%', '')
      .trim()
  )
function parseByteSize(value: string): number | null {
  const match = String(value || '')
    .trim()
    .match(/^([\d.]+)\s*([kmgt]?i?b)$/i)
  if (!match) return null
  const units: Record<string, number> = {
    b: 1,
    kb: 1e3,
    mb: 1e6,
    gb: 1e9,
    tb: 1e12,
    kib: 1024,
    mib: 1048576,
    gib: 1073741824,
    tib: 1099511627776
  }
  return Number(match[1]) * (units[match[2].toLowerCase()] || 1)
}

function findByPrefix<T>(map: Map<string, T>, id: string): T | undefined {
  return map.get(id) || [...map.entries()].find(([k]) => k.startsWith(id) || id.startsWith(k))?.[1]
}

/** 采集一次并原地更新 docker 状态。 */
export async function collectDocker(host: Host, docker: DockerState): Promise<void> {
  const done = (status: DockerStatus, error: string | null): void => {
    docker.status = status
    docker.error = error
    docker.lastCollectedAt = Date.now()
  }
  let check: string
  try {
    check = await execOk(host, CHECK_COMMAND, TIMEOUT_MS, 65536)
  } catch (error) {
    return done(failureStatus(error), safeError(error))
  }
  if (check.includes('__RM_DOCKER_NOT_INSTALLED__')) {
    docker.version = null
    docker.containers = []
    return done('not_installed', '未检测到 docker 命令')
  }
  const d = check.includes('__RM_DOCKER__sudo') ? 'sudo -n docker' : 'docker'
  docker.version =
    check
      .replace(/__RM_DOCKER__\w+/, '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop()
      ?.slice(0, 100) || null

  let psRows: Record<string, unknown>[]
  try {
    psRows = parseLines(await execOk(host, `${d} ${PS}`, TIMEOUT_MS, OUTPUT_LIMIT))
  } catch (error) {
    return done(failureStatus(error), `容器清单采集失败：${safeError(error)}`)
  }
  const statsById = new Map<string, Record<string, unknown>>()
  const statsByName = new Map<string, Record<string, unknown>>()
  let statsError: string | null = null
  try {
    for (const stat of parseLines(await execOk(host, `${d} ${STATS}`, TIMEOUT_MS, OUTPUT_LIMIT))) {
      if (stat.ID) statsById.set(String(stat.ID), stat)
      if (stat.Name || stat.Names) statsByName.set(String(stat.Name || stat.Names), stat)
    }
  } catch (error) {
    statsError = `资源采集失败：${safeError(error)}`
  }
  const inspectById = new Map<string, Record<string, unknown>>()
  let inspectError: string | null = null
  try {
    const out = await execOk(host, inspectCommand(d), TIMEOUT_MS, OUTPUT_LIMIT)
    for (const item of parseLines(out)) if (item?.Id) inspectById.set(String(item.Id), item)
  } catch (error) {
    inspectError = `补充信息采集失败：${safeError(error)}`
  }
  docker.containers = psRows.map((row) => {
    const id = String(row.ID || '').slice(0, 64)
    const name = String(row.Names || row.Name || '').slice(0, 255)
    const stat = findByPrefix(statsById, id) || statsByName.get(name) || {}
    const inspected = findByPrefix(inspectById, id) || {}
    const health =
      (row.Health as string) ||
      String(row.Status || '')
        .match(/\((healthy|unhealthy|health: starting|starting)\)/i)?.[1]
        ?.replace('health: ', '')
    const memParts = String(stat.MemUsage || '')
      .split('/')
      .map((x) => x.trim())
    return {
      id,
      name,
      image: String(row.Image || '').slice(0, 500),
      state: dockerState(row.State || inspected.Status),
      status: String(row.Status || '').slice(0, 500),
      ports: String(row.Ports || '').slice(0, 1000),
      createdAt: String(row.CreatedAt || '').slice(0, 100),
      health: dockerHealth(health),
      restartCount: num(inspected.RestartCount) ?? 0,
      composeProject: String(inspected.ComposeProject || '').slice(0, 255),
      composeService: String(inspected.ComposeService || '').slice(0, 255),
      cpuPercent: parsePercent(stat.CPUPerc),
      memoryUsage: String(stat.MemUsage || '').slice(0, 100),
      memoryUsedBytes: parseByteSize(memParts[0]),
      memoryPercent: parsePercent(stat.MemPerc),
      networkIO: String(stat.NetIO || '').slice(0, 100),
      blockIO: String(stat.BlockIO || '').slice(0, 100),
      pids: num(stat.PIDs)
    }
  })
  done('available', [statsError, inspectError].filter(Boolean).join('；') || null)
}
