// 监控中心(GRID-WATCH)主进程 ↔ 渲染端共享的数据形状。
// 设备/容器/LLM 的形状沿用 resource-monitor 原 HTTP API,前端视图按原样消费。

export type McCollectionStatus =
  'online' | 'degraded' | 'auth_failed' | 'unreachable' | 'unsupported' | 'pending'

export type McAlert = 'ok' | 'warn' | 'crit'

export interface McEvent {
  id: string
  t: number
  level: 'info' | 'warn' | 'crit'
  deviceId: string
  device: string
  msg: string
}

/** 每 2 秒推送一次的快照。events 只含上次推送后新增的事件。 */
export interface McTick {
  type: 'tick'
  t: number
  locked: boolean
  devices: unknown[]
  events: McEvent[]
  totals: unknown
}

// ---------- 拓扑发现 ----------

/** gateway → app → llm → data 为应用视图里的层次;infra 默认隐藏。 */
export type McCategory = 'gateway' | 'app' | 'llm' | 'data' | 'infra' | 'external'
export type McDeploy = 'docker' | 'k8s' | 'systemd' | 'process' | 'external'

export interface McPort {
  port: number
  /** 监听地址:0.0.0.0 / :: / 127.0.0.1 / 容器内 IP … */
  bind: string
  /** docker 发布到宿主机的端口(容器端口 → 宿主端口)。 */
  published?: number
}

export interface McService {
  id: string
  hostId: string
  category: McCategory
  /** 具体类型,如 nginx / vllm / mysql / java / python。 */
  kind: string
  name: string
  deploy: McDeploy
  containerId?: string
  containerName?: string
  image?: string
  composeProject?: string
  unit?: string
  pid?: number
  process?: string
  cmd?: string
  ports: McPort[]
  /** 类型相关信息:model / servedName / tp / gpus / version / routes … */
  meta: Record<string, unknown>
  firstSeen: number
  lastSeen: number
  state: 'new' | 'ok' | 'missing'
}

export type McEdgeKind = 'proxy' | 'conn' | 'config'

export interface McEdge {
  id: string
  from: string
  to: string
  kind: McEdgeKind
  label?: string
  /** 关系依据,如「nginx: location /v1 → proxy_pass http://127.0.0.1:8000」。 */
  evidence: string[]
  count?: number
}

export interface McTopoHost {
  hostId: string
  name: string
  address: string
  hostname?: string
  ips: string[]
  status: 'ok' | 'error' | 'unsupported' | 'pending'
  error?: string
  discoveredAt?: number
  docker?: boolean
  sudo?: boolean
}

export interface McTopology {
  discoveredAt: number | null
  hosts: McTopoHost[]
  services: McService[]
  edges: McEdge[]
}

export interface McDiscoveryProgress {
  phase: 'start' | 'host' | 'hostDone' | 'done' | 'cancelled'
  index: number
  total: number
  hostId?: string
  hostName?: string
  error?: string
  running: boolean
}
