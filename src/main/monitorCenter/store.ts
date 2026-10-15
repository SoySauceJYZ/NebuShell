// 监控中心本地持久化(替代原项目的 MySQL):userData/monitor-center/ 下的 JSON / JSONL 文件。
//   config.json      主机启用/排序 + 模型端点      (≈ physical_devices 非凭据字段 + model_endpoints)
//   state.json       每台主机最近一次硬件/指标/状态 (≈ device_hardware + device_metric_latest)
//   history/<id>.jsonl 60 秒一行、保留 7 天         (≈ device_metric_history)
//   events.json      最近 300 条事件
//   topology.json    拓扑发现快照
import { app } from 'electron'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  renameSync
} from 'fs'
import { join } from 'path'
import type { LlmEndpointConfig } from './collect/llm'
import type { Hardware, Metric } from './collect/system'
import type { McEvent, McTopology } from '../../shared/monitorCenter'
import type { DiscoveryFacts } from './discovery/types'

export const HISTORY_RETENTION_MS = 7 * 24 * 3600 * 1000

export interface HostPref {
  enabled: boolean
  sortOrder: number
}

export interface McConfig {
  hosts: Record<string, HostPref>
  llmEndpoints: LlmEndpointConfig[]
}

export interface PersistedHostState {
  osType: 'unknown' | 'linux' | 'windows'
  status: string
  lastError: string | null
  lastSeenAt: number | null
  hardware: Hardware | null
  metric: Metric | null
}

export interface HistoryRow {
  t: number
  cpu: number | null
  mem: number | null
  load1: number | null
  rx: number | null
  tx: number | null
  gpu: number | null
  gpuMem: number | null
}

export interface TopologyFile {
  topology: McTopology
  facts: Record<string, DiscoveryFacts>
}

const dir = (): string => join(app.getPath('userData'), 'monitor-center')
const file = (name: string): string => join(dir(), name)

function isSafeId(id: string): boolean {
  return !!id && /^[\w.-]+$/.test(id) && !id.includes('..')
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const p = file(name)
    if (!existsSync(p)) return fallback
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(name: string, value: unknown): void {
  mkdirSync(dir(), { recursive: true })
  const p = file(name)
  const tmp = `${p}.tmp`
  // 先写临时文件再替换,写到一半崩溃不会损坏原文件。
  writeFileSync(tmp, JSON.stringify(value), 'utf8')
  try {
    renameSync(tmp, p)
  } catch {
    writeFileSync(p, readFileSync(tmp))
    try {
      unlinkSync(tmp)
    } catch {
      // best effort
    }
  }
}

export const store = {
  loadConfig(): McConfig {
    const c = readJson<Partial<McConfig>>('config.json', {})
    return {
      hosts: c.hosts && typeof c.hosts === 'object' ? c.hosts : {},
      llmEndpoints: Array.isArray(c.llmEndpoints) ? c.llmEndpoints : []
    }
  },
  saveConfig(c: McConfig): void {
    writeJson('config.json', c)
  },

  loadState(): Record<string, PersistedHostState> {
    return readJson('state.json', {})
  },
  saveState(s: Record<string, PersistedHostState>): void {
    writeJson('state.json', s)
  },

  loadEvents(): McEvent[] {
    const e = readJson<McEvent[]>('events.json', [])
    return Array.isArray(e) ? e : []
  },
  saveEvents(e: McEvent[]): void {
    writeJson('events.json', e)
  },

  loadTopology(): TopologyFile | null {
    return readJson<TopologyFile | null>('topology.json', null)
  },
  saveTopology(t: TopologyFile): void {
    writeJson('topology.json', t)
  },

  appendHistory(hostId: string, row: HistoryRow): void {
    if (!isSafeId(hostId)) return
    mkdirSync(join(dir(), 'history'), { recursive: true })
    appendFileSync(join(dir(), 'history', `${hostId}.jsonl`), `${JSON.stringify(row)}\n`, 'utf8')
  },

  /** 最近 limit 行(时间升序)。 */
  readHistory(hostId: string, limit: number): HistoryRow[] {
    if (!isSafeId(hostId)) return []
    const p = join(dir(), 'history', `${hostId}.jsonl`)
    if (!existsSync(p)) return []
    try {
      const lines = readFileSync(p, 'utf8').trim().split('\n').slice(-limit)
      return lines.flatMap((l) => {
        try {
          return [JSON.parse(l) as HistoryRow]
        } catch {
          return []
        }
      })
    } catch {
      return []
    }
  },

  /** 删除 7 天前的历史行;主机已不在列表中的历史文件整份删除。 */
  pruneHistory(keepIds: Set<string>): void {
    const hdir = join(dir(), 'history')
    if (!existsSync(hdir)) return
    const cutoff = Date.now() - HISTORY_RETENTION_MS
    for (const name of readdirSync(hdir)) {
      if (!name.endsWith('.jsonl')) continue
      const p = join(hdir, name)
      const id = name.slice(0, -6)
      try {
        if (!keepIds.has(id)) {
          unlinkSync(p)
          continue
        }
        const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
        const kept = lines.filter((l) => {
          try {
            return (JSON.parse(l) as HistoryRow).t >= cutoff
          } catch {
            return false
          }
        })
        if (kept.length !== lines.length)
          writeFileSync(p, kept.length ? `${kept.join('\n')}\n` : '')
      } catch {
        // 单个文件出错不影响其它主机
      }
    }
  }
}
