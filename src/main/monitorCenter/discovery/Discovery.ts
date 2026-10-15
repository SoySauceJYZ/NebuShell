// 手动触发的拓扑发现:逐台主机顺序执行发现脚本,每完成一台就重建全局拓扑并推送进度。
import type { Host } from '../../../shared/types'
import type { McDiscoveryProgress, McTopology } from '../../../shared/monitorCenter'
import { monitorSshPool, safeError } from '../util'
import { store } from '../store'
import { DISCOVERY_SCRIPT } from './script'
import { parseDiscovery } from './parse'
import { buildTopology } from './graph'
import type { DiscoveryFacts } from './types'

const HOST_TIMEOUT_MS = 90_000
const MAX_OUTPUT = 12 * 1024 * 1024

export class DiscoveryRunner {
  facts: Record<string, DiscoveryFacts> = {}
  topology: McTopology = { discoveredAt: null, hosts: [], services: [], edges: [] }
  progress: McDiscoveryProgress = { phase: 'done', index: 0, total: 0, running: false }
  private cancelled = false
  private loaded = false

  constructor(
    private onProgress: (p: McDiscoveryProgress) => void,
    private onTopology: (t: McTopology) => void
  ) {}

  load(): void {
    if (this.loaded) return
    this.loaded = true
    const saved = store.loadTopology()
    if (saved?.topology) this.topology = saved.topology
    if (saved?.facts) this.facts = saved.facts
  }

  get running(): boolean {
    return this.progress.running
  }

  /** 主机列表变化(增删改名)后刷新拓扑里的主机信息,不重新发现。 */
  refreshHosts(hosts: Host[]): void {
    this.load()
    for (const id of Object.keys(this.facts)) {
      if (!hosts.some((h) => h.id === id)) delete this.facts[id]
    }
    this.topology = buildTopology(this.facts, hosts, this.topology)
  }

  cancel(): void {
    if (this.progress.running) this.cancelled = true
  }

  private emit(p: Partial<McDiscoveryProgress>): void {
    this.progress = { ...this.progress, ...p }
    this.onProgress(this.progress)
  }

  async run(targets: Host[], allHosts: Host[]): Promise<void> {
    this.load()
    if (this.progress.running) throw new Error('拓扑发现正在进行中')
    this.cancelled = false
    const total = targets.length
    this.emit({
      phase: 'start',
      index: 0,
      total,
      running: true,
      hostId: undefined,
      hostName: undefined,
      error: undefined
    })
    for (let i = 0; i < targets.length; i++) {
      if (this.cancelled) break
      const host = targets[i]
      this.emit({
        phase: 'host',
        index: i,
        hostId: host.id,
        hostName: host.label,
        error: undefined
      })
      let facts: DiscoveryFacts
      try {
        const r = await monitorSshPool.exec(host, 'sh -s', {
          timeoutMs: HOST_TIMEOUT_MS,
          maxBytes: MAX_OUTPUT,
          stdin: DISCOVERY_SCRIPT
        })
        facts = parseDiscovery(r.stdout, host)
        if (r.timedOut && facts.status === 'ok') facts.error = '发现脚本执行超时，结果可能不完整'
      } catch (e) {
        facts = {
          hostId: host.id,
          name: host.label,
          address: host.address,
          ips: [],
          discoveredAt: Date.now(),
          status: 'error',
          error: safeError(e),
          docker: false,
          sudo: false,
          services: [],
          conns: [],
          refs: [],
          containers: []
        }
      }
      // 失败时保留该主机上一次成功的结果,只更新状态
      const old = this.facts[host.id]
      if (facts.status !== 'ok' && old?.status === 'ok') {
        this.facts[host.id] = { ...old, status: facts.status, error: facts.error }
      } else this.facts[host.id] = facts
      this.topology = buildTopology(this.facts, allHosts, this.topology)
      store.saveTopology({ topology: this.topology, facts: this.facts })
      this.onTopology(this.topology)
      this.emit({
        phase: 'hostDone',
        index: i + 1,
        hostId: host.id,
        hostName: host.label,
        error: facts.error
      })
    }
    this.emit({ phase: this.cancelled ? 'cancelled' : 'done', running: false })
  }
}
