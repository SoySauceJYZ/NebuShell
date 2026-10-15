// 监控中心主进程核心:按主机库里的服务器无 Agent 采集,汇总成 resource-monitor 原 API 的数据形状。
// 只在渲染端持有「租约」(监控中心标签页打开)期间采集;租约全部过期即停止并回收 SSH 连接。
import { broadcast } from '../broadcast'
import { listVaultHosts } from '../mcp/McpSshPool'
import type { Host } from '../../shared/types'
import type {
  McCollectionStatus,
  McDiscoveryProgress,
  McEvent,
  McTopology
} from '../../shared/monitorCenter'
import { execOk, monitorSshPool, probePort, round, safeError } from './util'
import {
  IDENTITY_COMMAND,
  LINUX_COMMAND,
  WINDOWS_COMMAND,
  parseLinux,
  parseWindows,
  type CollectResult,
  type Hardware,
  type Metric,
  type NetSample
} from './collect/system'
import { collectDocker, emptyDocker, type DockerState } from './collect/docker'
import { LlmEndpoint, type LlmEndpointConfig } from './collect/llm'
import { store, type HostPref, type McConfig, type PersistedHostState } from './store'
import { DiscoveryRunner } from './discovery/Discovery'

const TICK_MS = 2000
const COLLECT_MS = 15000
const DOCKER_COLLECT_MS = 30000
const RELOAD_MS = 60000
const PORT_SCAN_MS = 300000
const HARDWARE_MS = 1800000
const HISTORY_MS = 60000
const HISTORY_LIMIT = 150
const LLM_METRICS_MS = 10000
const LLM_MODELS_MS = 300000
const LEASE_TTL_MS = 45000
const SAVE_MS = 30000

interface Hist {
  cpu: number[]
  mem: number[]
  rx: number[]
  tx: number[]
  gpu: number[]
  tps: number[]
}

interface Runtime {
  host: Host
  pref: HostPref
  busy: boolean
  dockerBusy: boolean
  ports: { ssh: boolean; winrmHttp: boolean; winrmHttps: boolean }
  lastScanAt: number
  hardwareAt: number
  historyAt: number
  status: McCollectionStatus
  lastError: string | null
  lastSeenAt: number | null
  osType: 'unknown' | 'linux' | 'windows'
  metric: Metric | null
  hardware: Hardware | null
  docker: DockerState
  hist: Hist
  netSample: NetSample | null
}

const bytesToGb = (v: number | null | undefined): number | null =>
  v == null ? null : round(v / 1073741824, 1)

class MonitorCenter {
  private runtimes = new Map<string, Runtime>()
  private config: McConfig = { hosts: {}, llmEndpoints: [] }
  private llm = new Map<string, LlmEndpoint>()
  private events: McEvent[] = []
  private pending: McEvent[] = []
  private intervals: ReturnType<typeof setInterval>[] = []
  private leases = new Map<string, number>()
  private watchdog: ReturnType<typeof setInterval> | null = null
  private loaded = false
  private locked = false
  private seq = 0
  private stateDirty = false
  private eventsDirty = false
  readonly discovery = new DiscoveryRunner(
    (p) => broadcast('monitorCenter:discovery', p),
    (t) => {
      this.syncDiscoveredLlm(t)
      broadcast('monitorCenter:topology', t)
    }
  )

  // ---------- 生命周期 ----------

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    this.config = store.loadConfig()
    this.events = store.loadEvents().slice(0, 300)
    this.discovery.load()
    this.reloadHosts(true)
    this.rebuildLlm()
  }

  get running(): boolean {
    return this.intervals.length > 0
  }

  acquire(): string {
    this.ensureLoaded()
    const id = `lease-${Date.now().toString(36)}-${(this.seq++).toString(36)}`
    this.leases.set(id, Date.now() + LEASE_TTL_MS)
    if (!this.watchdog) this.watchdog = setInterval(() => this.checkLeases(), 10000)
    this.start()
    return id
  }

  renew(id: string): boolean {
    if (!this.leases.has(id)) {
      // 主进程重启或租约过期后,渲染端续约时直接补发
      this.leases.set(id, Date.now() + LEASE_TTL_MS)
      if (!this.watchdog) this.watchdog = setInterval(() => this.checkLeases(), 10000)
      this.start()
      return true
    }
    this.leases.set(id, Date.now() + LEASE_TTL_MS)
    return true
  }

  release(id: string): void {
    this.leases.delete(id)
    this.checkLeases()
  }

  private checkLeases(): void {
    const now = Date.now()
    for (const [id, exp] of this.leases) if (exp < now) this.leases.delete(id)
    if (this.leases.size === 0) {
      this.stop()
      if (this.watchdog) clearInterval(this.watchdog)
      this.watchdog = null
    }
  }

  private start(): void {
    if (this.running) return
    this.reloadHosts(false)
    store.pruneHistory(new Set(this.runtimes.keys()))
    this.pushEvent('info', 'system', 'MONITOR', '监控中心采集引擎已启动，探针上线')
    for (const r of this.enabledRuntimes()) void this.collect(r)
    for (const e of this.llm.values()) void e.probe(true)
    const every = (ms: number, fn: () => void): void => {
      this.intervals.push(setInterval(fn, ms))
    }
    every(TICK_MS, () => this.tick())
    every(COLLECT_MS, () => this.enabledRuntimes().forEach((r) => void this.collect(r)))
    every(DOCKER_COLLECT_MS, () =>
      this.enabledRuntimes().forEach((r) => void this.collectDocker(r))
    )
    every(RELOAD_MS, () => this.reloadHosts(false))
    every(LLM_METRICS_MS, () => this.llm.forEach((e) => void e.probe(false)))
    every(LLM_MODELS_MS, () => this.llm.forEach((e) => void e.probe(true)))
    every(SAVE_MS, () => this.flush())
    every(3600000, () => store.pruneHistory(new Set(this.runtimes.keys())))
  }

  private stop(): void {
    if (!this.running) return
    for (const t of this.intervals) clearInterval(t)
    this.intervals = []
    this.flush()
    // 拓扑发现仍在跑时不回收连接,避免把正在执行的发现脚本断掉
    if (!this.discovery.running) monitorSshPool.closeAll()
  }

  private flush(): void {
    if (this.stateDirty) {
      const out: Record<string, PersistedHostState> = {}
      for (const [id, r] of this.runtimes) {
        out[id] = {
          osType: r.osType,
          status: r.status,
          lastError: r.lastError,
          lastSeenAt: r.lastSeenAt,
          hardware: r.hardware,
          metric: r.metric
        }
      }
      store.saveState(out)
      this.stateDirty = false
    }
    if (this.eventsDirty) {
      store.saveEvents(this.events)
      this.eventsDirty = false
    }
  }

  // ---------- 主机 ----------

  private vaultHosts(): Host[] {
    try {
      const hosts = listVaultHosts()
      this.locked = false
      return hosts
    } catch {
      this.locked = true
      return []
    }
  }

  private reloadHosts(initial: boolean): void {
    const hosts = this.vaultHosts()
    if (this.locked && !initial) return
    const persisted = initial ? store.loadState() : {}
    const next = new Map<string, Runtime>()
    hosts.forEach((host, i) => {
      const pref = this.config.hosts[host.id] ?? { enabled: true, sortOrder: (i + 1) * 10 }
      const old = this.runtimes.get(host.id)
      if (old) {
        // 地址/端口/凭据变了就重新探测端口并重建连接
        if (old.host.address !== host.address || old.host.port !== host.port) {
          old.lastScanAt = 0
          old.osType = 'unknown'
        }
        old.host = host
        old.pref = pref
        next.set(host.id, old)
        return
      }
      const p = persisted[host.id]
      const backfill = store.readHistory(host.id, HISTORY_LIMIT)
      const col = <K extends keyof (typeof backfill)[number]>(k: K): number[] =>
        backfill.map((row) => row[k]).filter((v): v is number => typeof v === 'number')
      next.set(host.id, {
        host,
        pref,
        busy: false,
        dockerBusy: false,
        ports: { ssh: false, winrmHttp: false, winrmHttps: false },
        lastScanAt: 0,
        hardwareAt: 0,
        historyAt: backfill.length ? backfill[backfill.length - 1].t : 0,
        status: (p?.status as McCollectionStatus) || 'pending',
        lastError: p?.lastError ?? null,
        lastSeenAt: p?.lastSeenAt ?? null,
        osType: p?.osType ?? 'unknown',
        metric: p?.metric ?? null,
        hardware: p?.hardware ?? null,
        docker: emptyDocker(),
        hist: {
          cpu: col('cpu'),
          mem: col('mem'),
          rx: col('rx'),
          tx: col('tx'),
          gpu: col('gpu'),
          tps: []
        },
        netSample: null
      })
    })
    this.runtimes = next
    this.discovery.refreshHosts(hosts)
  }

  private enabledRuntimes(): Runtime[] {
    return this.sortedRuntimes().filter((r) => r.pref.enabled)
  }

  private sortedRuntimes(): Runtime[] {
    return [...this.runtimes.values()].sort((a, b) => a.pref.sortOrder - b.pref.sortOrder)
  }

  private savePref(id: string, patch: Partial<HostPref>): void {
    const r = this.runtimes.get(id)
    if (!r) throw new Error('主机不存在（可能已从主机列表删除）')
    r.pref = { ...r.pref, ...patch }
    this.config.hosts[id] = r.pref
    store.saveConfig(this.config)
  }

  // ---------- 事件 ----------

  private pushEvent(level: McEvent['level'], deviceId: string, device: string, msg: string): void {
    const ev: McEvent = {
      id: `ev-${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      t: Date.now(),
      level,
      deviceId,
      device,
      msg
    }
    this.events.unshift(ev)
    if (this.events.length > 300) this.events.length = 300
    this.pending.push(ev)
    this.eventsDirty = true
  }

  // ---------- 采集 ----------

  private async scan(r: Runtime): Promise<void> {
    const [ssh, winrmHttp, winrmHttps] = await Promise.all([
      probePort(r.host.address, r.host.port || 22),
      probePort(r.host.address, 5985),
      probePort(r.host.address, 5986)
    ])
    r.ports = { ssh, winrmHttp, winrmHttps }
    r.lastScanAt = Date.now()
  }

  private setFailure(r: Runtime, status: McCollectionStatus, message: string): void {
    const old = r.status
    r.status = status
    r.lastError = message
    this.stateDirty = true
    if (old === 'online' || old === 'degraded') {
      this.pushEvent('crit', r.host.id, r.host.label, `物理设备离线：${message}`)
    }
  }

  private async collect(r: Runtime, force = false): Promise<void> {
    if (r.busy || (!this.running && !force)) return
    r.busy = true
    try {
      if (!r.lastScanAt || Date.now() - r.lastScanAt >= PORT_SCAN_MS || !r.ports.ssh)
        await this.scan(r)
      if (!r.ports.ssh) {
        if (r.ports.winrmHttp || r.ports.winrmHttps) {
          this.setFailure(r, 'unsupported', 'WinRM 可用但采集器待接入')
        } else
          this.setFailure(r, 'unreachable', `SSH 端口 ${r.host.port || 22} 与 WinRM 端口均不可达`)
        return
      }
      let result: CollectResult
      const runWindows = async (): Promise<CollectResult> => {
        const w = parseWindows(await execOk(r.host, WINDOWS_COMMAND, 15000), r.netSample)
        r.netSample = w.sample
        return w
      }
      if (r.osType === 'windows') result = await runWindows()
      else if (r.osType === 'linux') result = parseLinux(await execOk(r.host, LINUX_COMMAND))
      else {
        const identity = await execOk(r.host, IDENTITY_COMMAND)
        result = /windows|^\d+\.\d+/i.test(identity.trim())
          ? await runWindows()
          : parseLinux(await execOk(r.host, LINUX_COMMAND))
      }
      if (this.runtimes.get(r.host.id) === r) {
        this.saveSuccess(r, result)
        if (!r.docker.lastCollectedAt) void this.collectDocker(r)
      }
    } catch (error) {
      const message = safeError(error)
      const auth =
        /authentication|all configured authentication methods failed|permission denied/i.test(
          message
        )
      this.setFailure(r, auth ? 'auth_failed' : 'degraded', message)
    } finally {
      r.busy = false
    }
  }

  private saveSuccess(r: Runtime, result: CollectResult): void {
    const old = r.status
    const now = Date.now()
    r.status = 'online'
    r.lastError = null
    r.lastSeenAt = now
    r.metric = result.metric
    r.hardware = result.hardware
    r.osType = result.osType
    this.stateDirty = true
    const g = result.metric.gpus || []
    const utils = g.map((x) => x.util).filter((x): x is number => x != null)
    const gpuUtil = utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : null
    const used = g.reduce((a, x) => a + (x.vramUsed || 0), 0)
    const total = g.reduce((a, x) => a + (x.vramTotal || 0), 0)
    const m = result.metric
    const memPct =
      m.memoryTotal && m.memoryUsed != null ? (m.memoryUsed / m.memoryTotal) * 100 : null
    const rx = m.networkRxBps == null ? null : m.networkRxBps / 1048576
    const tx = m.networkTxBps == null ? null : m.networkTxBps / 1048576
    const push = (arr: number[], v: number | null): void => {
      if (v != null) arr.push(round(v) as number)
      if (arr.length > HISTORY_LIMIT) arr.shift()
    }
    push(r.hist.cpu, m.cpuPercent)
    push(r.hist.mem, memPct)
    push(r.hist.rx, rx)
    push(r.hist.tx, tx)
    push(r.hist.gpu, gpuUtil)
    if (!r.hardwareAt || now - r.hardwareAt >= HARDWARE_MS) r.hardwareAt = now
    if (!r.historyAt || now - r.historyAt >= HISTORY_MS) {
      store.appendHistory(r.host.id, {
        t: now,
        cpu: m.cpuPercent,
        mem: round(memPct),
        load1: m.load1,
        rx: round(rx, 3),
        tx: round(tx, 3),
        gpu: round(gpuUtil),
        gpuMem: total ? round((used / total) * 100) : null
      })
      r.historyAt = now
    }
    if (old !== 'online') this.pushEvent('info', r.host.id, r.host.label, '物理设备采集恢复')
  }

  private async collectDocker(r: Runtime): Promise<void> {
    if (
      r.dockerBusy ||
      !this.running ||
      r.status !== 'online' ||
      !r.ports.ssh ||
      r.osType === 'windows'
    )
      return
    r.dockerBusy = true
    try {
      await collectDocker(r.host, r.docker)
    } catch (e) {
      r.docker.status = 'error'
      r.docker.error = safeError(e)
      r.docker.lastCollectedAt = Date.now()
    } finally {
      r.dockerBusy = false
    }
  }

  // ---------- LLM 端点 ----------

  private rebuildLlm(): void {
    const next = new Map<string, LlmEndpoint>()
    for (const cfg of this.config.llmEndpoints) {
      const old = this.llm.get(cfg.id)
      if (old && old.config.baseUrl === cfg.baseUrl && !!old.config.localOnly === !!cfg.localOnly) {
        old.config = { ...cfg, model: cfg.model || old.config.model }
        next.set(cfg.id, old)
      } else {
        next.set(
          cfg.id,
          new LlmEndpoint({ ...cfg }, (l, id, n, msg) => this.pushEvent(l, id, n, msg))
        )
      }
    }
    this.llm = next
  }

  /** 拓扑里发现的模型服务 → LLM 端点(手动添加的保留不动)。 */
  private syncDiscoveredLlm(t: McTopology): void {
    const ENGINE: Record<string, string> = {
      vllm: 'vLLM',
      sglang: 'SGLang',
      ollama: 'Ollama',
      lmdeploy: 'LMDeploy',
      tgi: 'TGI',
      tei: 'TEI',
      triton: 'Triton',
      xinference: 'Xinference',
      'llama.cpp': 'llama.cpp',
      localai: 'LocalAI',
      fastchat: 'FastChat',
      mindie: 'MindIE'
    }
    const discovered: LlmEndpointConfig[] = []
    for (const s of t.services) {
      if (s.category !== 'llm' || s.state === 'missing' || !s.hostId) continue
      const host = this.runtimes.get(s.hostId)?.host
      const port = Number(s.meta.port)
      if (!host || !port) continue
      const portInfo = s.ports.find((p) => (p.published ?? p.port) === port)
      const bind = portInfo?.published ? portInfo.bind : (portInfo?.bind ?? '0.0.0.0')
      const localOnly = /^(127\.|::1$|localhost$)/.test(bind)
      const model = String(s.meta.servedName || s.meta.modelShort || '')
      discovered.push({
        id: `disc:${s.id}`,
        baseUrl: `http://${host.address.includes(':') ? `[${host.address}]` : host.address}:${port}`,
        chatPath: '/v1/chat/completions',
        model,
        engine: ENGINE[s.kind] || s.kind,
        enabled: true,
        source: 'discovered',
        hostId: s.hostId,
        serviceId: s.id,
        localOnly
      })
    }
    const manual = this.config.llmEndpoints.filter((e) => e.source !== 'discovered')
    const before = JSON.stringify(this.config.llmEndpoints)
    this.config.llmEndpoints = [...manual, ...discovered]
    if (JSON.stringify(this.config.llmEndpoints) !== before) {
      store.saveConfig(this.config)
      this.rebuildLlm()
      if (this.running) for (const e of this.llm.values()) if (!e.lastProbeAt) void e.probe(true)
    }
  }

  // ---------- 视图(与原 HTTP API 同形) ----------

  private alert(r: Runtime): 'ok' | 'warn' | 'crit' {
    if (r.status === 'auth_failed' || r.status === 'unreachable') return 'crit'
    if (r.status !== 'online') return 'warn'
    const m = r.metric
    if ((m?.cpuPercent ?? 0) > 96) return 'crit'
    if (
      (m?.cpuPercent ?? 0) > 88 ||
      (m?.memoryTotal && (m.memoryUsed ?? 0) / m.memoryTotal > 0.93)
    ) {
      return 'warn'
    }
    return 'ok'
  }

  private dockerView(
    r: Runtime
  ): Record<string, unknown> & {
    summary: Record<string, number>
    containers: { state: string }[]
  } {
    const d = r.docker
    let status: string = d.status
    if (r.status === 'unreachable' || r.status === 'auth_failed') status = r.status
    const containers = status === 'available' ? d.containers : []
    const running = containers.filter((x) => x.state === 'running').length
    return {
      deviceId: r.host.id,
      name: r.host.label,
      ip: r.host.address,
      os: r.hardware?.osName || r.osType || 'unknown',
      hostStatus: r.status,
      dockerStatus: status,
      dockerVersion: d.version,
      lastCollectedAt: d.lastCollectedAt,
      error: status === 'unreachable' || status === 'auth_failed' ? r.lastError : d.error,
      summary: {
        total: containers.length,
        running,
        stopped: containers.filter((x) => x.state !== 'running').length,
        unhealthy: containers.filter((x) => x.health === 'unhealthy').length,
        restarting: containers.filter((x) => x.state === 'restarting').length
      },
      containers
    }
  }

  private llmFor(hostId: string): LlmEndpoint[] {
    return [...this.llm.values()].filter((e) => e.config.hostId === hostId)
  }

  private summary(r: Runtime): Record<string, unknown> {
    const h = r.hardware
    const m = r.metric
    const docker = this.dockerView(r)
    const gpus = m?.gpus || h?.gpus || []
    const llm = this.llmFor(r.host.id)
    const sum = (k: 'tps' | 'rpm'): number | null => {
      const v = llm.map((e) => e.metrics[k]).filter((x): x is number => Number.isFinite(x))
      return v.length ? round(v.reduce((a, b) => a + b, 0)) : null
    }
    return {
      id: r.host.id,
      name: r.host.label,
      role: '物理设备 · 无 Agent',
      ip: r.host.address,
      os: h?.osName || r.osType || 'unknown',
      rack: null,
      linkSpeed: 'N/A',
      alert: this.alert(r),
      cpu: { util: m?.cpuPercent ?? null, cores: h?.cpuCores ?? null },
      mem: { used: bytesToGb(m?.memoryUsed), total: bytesToGb(m?.memoryTotal || h?.memoryTotal) },
      net: {
        rx: m?.networkRxBps == null ? null : round(m.networkRxBps / 1048576, 2),
        tx: m?.networkTxBps == null ? null : round(m.networkTxBps / 1048576, 2)
      },
      diskIo: null,
      disks: (m?.disks || h?.disks || []).map((d) => ({
        mount: d.mount,
        kind: d.kind,
        total: bytesToGb(d.total),
        usedPct: d.usedPct
      })),
      gpus,
      gpuCount: gpus.length,
      llmTps: sum('tps'),
      llmRpm: sum('rpm'),
      svcUp: docker.summary.running,
      svcTotal: docker.summary.total,
      uptimeSec: m?.uptime ?? null,
      collectionStatus: r.status,
      protocol: r.ports.ssh
        ? 'ssh'
        : r.ports.winrmHttps
          ? 'winrm-https'
          : r.ports.winrmHttp
            ? 'winrm-http'
            : 'ssh',
      lastError: r.lastError,
      lastSeenAt: r.lastSeenAt,
      ports: { ssh: r.ports.ssh, winrmHttp: r.ports.winrmHttp, winrmHttps: r.ports.winrmHttps },
      sshPort: r.host.port || 22
    }
  }

  private totals(devs: Record<string, unknown>[]): Record<string, unknown> {
    const allGpus = devs.flatMap(
      (d) =>
        (d.gpus as {
          util: number | null
          power: number | null
          vramUsed: number | null
          vramTotal: number | null
        }[]) || []
    )
    const containers = this.enabledRuntimes().flatMap(
      (r) => this.dockerView(r).containers as { state: string }[]
    )
    const llm = [...this.llm.values()]
    const sumLlm = (k: keyof LlmEndpoint['metrics']): number =>
      llm.reduce((s, e) => s + (Number(e.metrics[k]) || 0), 0)
    const fin = (arr: (number | null)[]): number[] =>
      arr.filter((x): x is number => Number.isFinite(x))
    const utils = fin(allGpus.map((g) => g.util))
    const power = fin(allGpus.map((g) => g.power))
    const vu = fin(allGpus.map((g) => g.vramUsed))
    const vt = fin(allGpus.map((g) => g.vramTotal))
    const day = Date.now() - 86400000
    return {
      devices: devs.length,
      gpus: allGpus.length,
      gpuUtilAvg: utils.length ? round(utils.reduce((a, b) => a + b, 0) / utils.length) : null,
      vramUsed: vu.length ? round(vu.reduce((a, b) => a + b, 0)) : null,
      vramTotal: vt.length ? round(vt.reduce((a, b) => a + b, 0)) : null,
      powerKw: power.length ? round(power.reduce((a, b) => a + b, 0) / 1000, 2) : null,
      models: llm.length,
      modelsLoaded: llm.filter((e) => e.apiOnline).length,
      tpsTotal: round(sumLlm('tps')),
      rpmTotal: round(sumLlm('rpm')),
      tokensTotal: Math.round(sumLlm('promptTokensTotal') + sumLlm('generationTokensTotal')),
      requestsTotal: Math.round(sumLlm('requestsTotal')),
      svcUp: containers.filter((x) => x.state === 'running').length,
      svcTotal: containers.length,
      dbCount: this.discovery.topology.services.filter(
        (s) => s.category === 'data' && s.state !== 'missing' && s.hostId
      ).length,
      alerts24h: this.events.filter((e) => e.t >= day && e.level !== 'info').length,
      warnDevices: devs.filter((d) => d.alert !== 'ok').length
    }
  }

  private tick(): void {
    const devices = this.getDevices()
    // 每台设备的推理吞吐也进曲线
    for (const r of this.enabledRuntimes()) {
      const llm = this.llmFor(r.host.id)
      if (!llm.length) continue
      const tps = llm.reduce((s, e) => s + (e.metrics.tps || 0), 0)
      r.hist.tps.push(round(tps) as number)
      if (r.hist.tps.length > HISTORY_LIMIT) r.hist.tps.shift()
    }
    const events = this.pending
    this.pending = []
    broadcast('monitorCenter:tick', {
      type: 'tick',
      t: Date.now(),
      locked: this.locked,
      devices,
      events,
      totals: this.totals(devices)
    })
  }

  // ---------- IPC 入口 ----------

  getDevices(): Record<string, unknown>[] {
    this.ensureLoaded()
    return this.enabledRuntimes().map((r) => this.summary(r))
  }

  getDevice(id: string): Record<string, unknown> | null {
    this.ensureLoaded()
    const r = this.runtimes.get(id)
    if (!r) return null
    const base = this.summary(r)
    const h = r.hardware
    return {
      ...base,
      kernel: h?.kernel || null,
      hardware: {
        cpu: {
          model: h?.cpuModel || null,
          cores: h?.cpuCores ?? null,
          threads: h?.cpuThreads ?? null,
          freq: null
        },
        mem: { total: (base.mem as { total: number | null }).total, type: null },
        gpus: h?.gpus || [],
        disks: base.disks
      },
      hist: r.hist,
      services: [],
      tags: r.host.tags || []
    }
  }

  getEvents(limit = 50): McEvent[] {
    this.ensureLoaded()
    return this.events.slice(0, Math.max(1, Math.min(300, limit)))
  }

  getServices(): Record<string, unknown>[] {
    this.ensureLoaded()
    return this.enabledRuntimes().map((r) => this.dockerView(r))
  }

  getLlm(): Record<string, unknown>[] {
    this.ensureLoaded()
    return [...this.llm.values()].map((e) => e.view())
  }

  getTotals(): Record<string, unknown> {
    return this.totals(this.getDevices())
  }

  getState(): { locked: boolean; running: boolean } {
    this.ensureLoaded()
    if (this.locked) this.reloadHosts(false)
    return { locked: this.locked, running: this.running }
  }

  getManaged(): Record<string, unknown>[] {
    this.ensureLoaded()
    return this.sortedRuntimes().map((r) => ({
      id: r.host.id,
      name: r.host.label,
      host: r.host.address,
      port: r.host.port || 22,
      username: r.host.username,
      protocol: 'auto',
      osType: r.osType,
      enabled: r.pref.enabled,
      sortOrder: r.pref.sortOrder,
      status: r.pref.enabled ? r.status : 'disabled',
      lastError: r.lastError,
      lastSeenAt: r.lastSeenAt,
      ports: r.ports,
      hostname: r.hardware?.hostname || null,
      osName: r.hardware?.osName || null,
      authType: r.host.authType,
      tags: r.host.tags || []
    }))
  }

  setHostEnabled(id: string, enabled: boolean): Record<string, unknown>[] {
    this.ensureLoaded()
    this.savePref(id, { enabled: !!enabled })
    const r = this.runtimes.get(id)
    if (r && enabled && this.running) void this.collect(r)
    return this.getManaged()
  }

  setHostOrder(id: string, sortOrder: number): Record<string, unknown>[] {
    this.ensureLoaded()
    if (!Number.isFinite(sortOrder)) throw new Error('排序必须为有效数字')
    this.savePref(id, { sortOrder: Math.round(sortOrder) })
    return this.getManaged()
  }

  async testHost(id: string, timeoutMs = 15000): Promise<Record<string, unknown> | undefined> {
    this.ensureLoaded()
    const r = this.runtimes.get(id)
    if (!r || !r.pref.enabled) throw new Error('主机不存在或已停用')
    const deadline = Date.now() + timeoutMs
    while (r.busy && Date.now() < deadline) await new Promise((res) => setTimeout(res, 100))
    if (r.busy) throw new Error('设备采集仍在进行，请稍后重试')
    r.lastScanAt = 0
    // 页面已关闭(无租约)时也允许单次测试
    await Promise.race([
      this.collect(r, true),
      new Promise((_, reject) => setTimeout(() => reject(new Error('设备测试超时')), timeoutMs))
    ])
    return this.getManaged().find((x) => x.id === id)
  }

  getTopology(): { topology: McTopology; progress: McDiscoveryProgress } {
    this.ensureLoaded()
    return { topology: this.discovery.topology, progress: this.discovery.progress }
  }

  discover(hostIds?: string[]): { started: boolean } {
    this.ensureLoaded()
    const all = this.vaultHosts()
    if (this.locked) throw new Error('保险库未解锁')
    const enabled = this.sortedRuntimes()
      .filter((r) => r.pref.enabled)
      .map((r) => r.host)
    const targets = hostIds?.length ? all.filter((h) => hostIds.includes(h.id)) : enabled
    if (!targets.length) throw new Error('没有可发现的主机')
    const winHosts = new Set(
      [...this.runtimes.values()].filter((r) => r.osType === 'windows').map((r) => r.host.id)
    )
    void this.discovery
      .run(
        targets.filter((h) => !winHosts.has(h.id)),
        all
      )
      .catch((e) =>
        broadcast('monitorCenter:discovery', {
          ...this.discovery.progress,
          running: false,
          error: safeError(e)
        })
      )
      .finally(() => {
        if (!this.running) monitorSshPool.closeAll()
      })
    return { started: true }
  }

  cancelDiscovery(): void {
    this.discovery.cancel()
  }
}

export const monitorCenter = new MonitorCenter()
