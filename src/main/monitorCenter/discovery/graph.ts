// 把各主机的 DiscoveryFacts 合成一张全局拓扑:解析连接/配置指向到具体服务,生成边。
// 每发现完一台主机就整体重建一次,所以跨主机关系会随着逐台发现逐步补全。
import type { McEdge, McService, McTopoHost, McTopology } from '../../../shared/monitorCenter'
import { guessByPort } from './classify'
import { isLoopback, isWildcard } from './parse'
import type { DiscoveryFacts, RawService } from './types'

interface HostCtx {
  facts: DiscoveryFacts
  /** ip:port → 服务 id(本机所有地址,含容器 IP) */
  local: Map<string, string>
  /** 宿主机网络命名空间里 127.0.0.1/0.0.0.0 上的端口 → 服务 id */
  loop: Map<number, string>
  /** 容器名/别名 → 服务 id */
  names: Map<string, string>
  /** 容器 id → 服务 id */
  containers: Map<string, string>
}

const svcId = (hostId: string, key: string): string => `${hostId}|${key}`

export function buildTopology(
  factsByHost: Record<string, DiscoveryFacts>,
  hostOrder: { id: string; label: string; address: string }[],
  previous: McTopology | null
): McTopology {
  const prevServices = new Map((previous?.services || []).map((s) => [s.id, s]))
  const now = Date.now()
  const ctxs = new Map<string, HostCtx>()
  const global = new Map<string, string>()
  const hostByName = new Map<string, string>()
  /** 主机 IP → 主机 id;多台主机共有的地址(如 docker0 的 172.17.0.1)记为空串表示不确定 */
  const ipHost = new Map<string, string>()
  const raw = new Map<string, { svc: RawService; hostId: string }>()

  for (const h of hostOrder) {
    const facts = factsByHost[h.id]
    hostByName.set(h.address.toLowerCase(), h.id)
    hostByName.set(h.label.toLowerCase(), h.id)
    if (!facts) continue
    if (facts.hostname) {
      hostByName.set(facts.hostname.toLowerCase(), h.id)
      hostByName.set(facts.hostname.split('.')[0].toLowerCase(), h.id)
    }
    const ctx: HostCtx = {
      facts,
      local: new Map(),
      loop: new Map(),
      names: new Map(),
      containers: new Map()
    }
    const hostIps = [...new Set([...facts.ips, h.address])].filter((ip) => !isLoopback(ip))
    for (const ip of hostIps) ipHost.set(ip, ipHost.has(ip) && ipHost.get(ip) !== h.id ? '' : h.id)
    for (const svc of facts.services) {
      const id = svcId(h.id, svc.key)
      raw.set(id, { svc, hostId: h.id })
      for (const l of svc.listen) {
        if (l.ns === 'container') {
          ctx.local.set(`${l.ip}:${l.port}`, id)
          continue
        }
        if (isWildcard(l.ip)) {
          ctx.loop.set(l.port, ctx.loop.get(l.port) ?? id)
          for (const ip of hostIps) {
            ctx.local.set(`${ip}:${l.port}`, id)
            if (!global.has(`${ip}:${l.port}`)) global.set(`${ip}:${l.port}`, id)
          }
        } else if (isLoopback(l.ip)) {
          ctx.loop.set(l.port, id)
        } else {
          ctx.local.set(`${l.ip}:${l.port}`, id)
          if (!global.has(`${l.ip}:${l.port}`)) global.set(`${l.ip}:${l.port}`, id)
        }
      }
    }
    for (const c of facts.containers) {
      const id = svcId(h.id, c.serviceKey)
      ctx.containers.set(c.id, id)
      ctx.names.set(c.name.toLowerCase(), id)
      for (const a of c.aliases)
        if (!ctx.names.has(a.toLowerCase())) ctx.names.set(a.toLowerCase(), id)
    }
    ctxs.set(h.id, ctx)
  }

  const services = new Map<string, McService>()
  const externals = new Map<string, McService>()
  const edges = new Map<string, McEdge>()

  const prevHostAt = new Map((previous?.hosts || []).map((h) => [h.hostId, h.discoveredAt ?? 0]))

  /**
   * new:该主机此前已发现过,但上次快照里没有这个服务;保持到该主机下一次被重新发现。
   * 主机第一次被发现时,所有服务都算 ok。
   */
  const stateOf = (id: string, hostId: string): McService['state'] => {
    const prev = prevServices.get(id)
    const at = ctxs.get(hostId)?.facts.discoveredAt ?? 0
    if (prev && prev.state !== 'missing') {
      return prev.state === 'new' && prev.lastSeen === at ? 'new' : 'ok'
    }
    if (prev) return 'new'
    const before = prevHostAt.get(hostId) ?? 0
    return before && before < at ? 'new' : 'ok'
  }

  const toService = (id: string, svc: RawService, hostId: string): McService => {
    const prev = prevServices.get(id)
    return {
      id,
      hostId,
      category: svc.category,
      kind: svc.kind,
      name: svc.name,
      deploy: svc.deploy,
      containerId: svc.containerId,
      containerName: svc.containerName,
      image: svc.image,
      composeProject: svc.composeProject,
      unit: svc.unit,
      pid: svc.pid,
      process: svc.process,
      cmd: svc.cmd,
      ports: svc.ports,
      meta: svc.meta,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: ctxs.get(hostId)?.facts.discoveredAt ?? now,
      state: stateOf(id, hostId)
    }
  }

  /** 解析目标地址 → 服务 id;null 表示自身(容器内 127.0.0.1),undefined 表示外部。 */
  const resolve = (
    hostId: string,
    ns: string,
    host: string,
    port: number
  ): string | null | undefined => {
    const ctx = ctxs.get(hostId)
    if (!ctx) return undefined
    const h = host.toLowerCase()
    if (isLoopback(h) || h === '0.0.0.0') {
      if (ns !== 'host') return ctx.containers.get(ns) ?? null
      return (
        ctx.loop.get(port) ??
        ctx.local.get(`${ctx.facts.ips.find((ip) => !isLoopback(ip))}:${port}`)
      )
    }
    if (h === 'host.docker.internal' || h === 'gateway.docker.internal') return ctx.loop.get(port)
    if (/^[\d.]+$/.test(h) || h.includes(':')) {
      const direct = ctx.local.get(`${h}:${port}`) ?? global.get(`${h}:${port}`)
      if (direct) return direct
      // 指向某台主机的 IP,但服务只监听 127.0.0.1:仍然关联到它(多半是配置有问题,证据里能看到)
      const owner = ctx.facts.ips.includes(h) ? hostId : ipHost.get(h)
      return owner ? ctxs.get(owner)?.loop.get(port) : undefined
    }
    const byName = ctx.names.get(h)
    if (byName) return byName
    const otherHost = hostByName.get(h) ?? hostByName.get(h.split('.')[0])
    if (otherHost) {
      const oc = ctxs.get(otherHost)
      if (oc)
        return (
          oc.loop.get(port) ?? [...oc.local.entries()].find(([k]) => k.endsWith(`:${port}`))?.[1]
        )
    }
    return undefined
  }

  const ensure = (id: string): boolean => {
    if (services.has(id)) return true
    const r = raw.get(id)
    if (!r) return false
    services.set(id, toService(id, r.svc, r.hostId))
    return true
  }

  const external = (host: string, port: number): string => {
    const id = `ext|${host}:${port}`
    if (!externals.has(id)) {
      const g = guessByPort(port)
      externals.set(id, {
        id,
        hostId: '',
        category: 'external',
        kind: g.kind,
        name: `${host}:${port}`,
        deploy: 'external',
        ports: [{ port, bind: host }],
        meta: { guess: g.kind },
        firstSeen: now,
        lastSeen: now,
        state: 'ok'
      })
    }
    return id
  }

  const addEdge = (
    from: string,
    to: string,
    kind: McEdge['kind'],
    evidence: string,
    label?: string,
    count = 1
  ): void => {
    if (from === to) return
    const id = `${kind}|${from}|${to}`
    const e = edges.get(id)
    if (e) {
      e.count = (e.count || 0) + count
      if (e.evidence.length < 6 && !e.evidence.includes(evidence)) e.evidence.push(evidence)
      if (label && e.label && !e.label.split(' · ').includes(label) && e.label.length < 60)
        e.label += ` · ${label}`
      return
    }
    edges.set(id, { id, from, to, kind, label, evidence: [evidence], count })
  }

  // 常驻服务先全部加入;仅有出站连接的客户端进程等关联上了再加。
  for (const [id, r] of raw) if (!r.svc.clientOnly) ensure(id)

  for (const [hostId, ctx] of ctxs) {
    for (const ref of ctx.facts.refs) {
      const from = svcId(hostId, ref.from)
      const to = resolve(hostId, ref.ns, ref.host, ref.port)
      if (to === null) continue
      if (!ensure(from)) continue
      const target = to && ensure(to) ? to : external(ref.host, ref.port)
      addEdge(from, target, ref.kind, ref.evidence, ref.kind === 'proxy' ? ref.label : undefined)
    }
    for (const conn of ctx.facts.conns) {
      const from = svcId(hostId, conn.from)
      const to = resolve(hostId, conn.ns, conn.ip, conn.port)
      if (to === null) continue
      const fromRaw = raw.get(from)
      if (to && raw.has(to)) {
        ensure(from)
        ensure(to)
        addEdge(
          from,
          to,
          'conn',
          `TCP → ${conn.ip}:${conn.port}（${conn.count} 条连接）`,
          undefined,
          conn.count
        )
      } else if (
        fromRaw &&
        !fromRaw.svc.clientOnly &&
        fromRaw.svc.category !== 'infra' &&
        conn.port < 32768 &&
        !isLoopback(conn.ip)
      ) {
        ensure(from)
        addEdge(
          from,
          external(conn.ip, conn.port),
          'conn',
          `TCP → ${conn.ip}:${conn.port}（${conn.count} 条连接）`,
          undefined,
          conn.count
        )
      }
    }
  }

  // 上次发现到、这次所在主机已重新发现却没出现的服务 → missing
  for (const prev of previous?.services || []) {
    if (services.has(prev.id) || prev.category === 'external') continue
    const ctx = ctxs.get(prev.hostId)
    if (!ctx) continue
    if (ctx.facts.status !== 'ok') {
      services.set(prev.id, prev)
      continue
    }
    if (prev.lastSeen >= ctx.facts.discoveredAt) continue
    // 已经标记过 missing、又经历了一次重新发现仍不在 → 移除
    const missingAt = prev.meta.missingAt as number | undefined
    if (prev.state === 'missing' && missingAt && missingAt !== ctx.facts.discoveredAt) continue
    services.set(prev.id, {
      ...prev,
      state: 'missing',
      meta: { ...prev.meta, missingAt: missingAt ?? ctx.facts.discoveredAt }
    })
  }

  const hosts: McTopoHost[] = hostOrder.map((h) => {
    const f = factsByHost[h.id]
    return {
      hostId: h.id,
      name: h.label,
      address: h.address,
      hostname: f?.hostname,
      ips: f?.ips.filter((ip) => !isLoopback(ip)) ?? [],
      status: f ? f.status : 'pending',
      error: f?.error,
      discoveredAt: f?.discoveredAt,
      docker: f?.docker,
      sudo: f?.sudo
    }
  })

  const all = [...services.values(), ...externals.values()]
  const ids = new Set(all.map((s) => s.id))
  return {
    discoveredAt: Math.max(0, ...Object.values(factsByHost).map((f) => f.discoveredAt)) || null,
    hosts,
    services: all,
    edges: [...edges.values()].filter((e) => ids.has(e.from) && ids.has(e.to))
  }
}
