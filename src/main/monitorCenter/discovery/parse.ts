// 把一台主机的发现脚本输出解析成「服务 + 出站连接 + 配置指向」(DiscoveryFacts)。
// 跨主机的关联(谁连到谁)在 graph.ts 里统一做。
import type { McDeploy, McPort } from '../../../shared/monitorCenter'
import { sections } from '../util'
import { classify, friendlyName, guessByPort, llmMeta } from './classify'
import { nginxListenPorts, parseNginx, type NginxRoute } from './nginx'
import type { DiscoveryFacts, RawConn, RawContainer, RawService } from './types'

interface Proc {
  pid: number
  ppid: number
  user: string
  comm: string
  args: string
}

interface Sock {
  lip: string
  lport: number
  rip: string
  rport: number
  pids: { pid: number; name: string }[]
}

interface DockerInspect {
  id: string
  name: string
  image: string
  pid: number
  status: string
  env: string[] | null
  cmd: string[] | null
  entrypoint: string[] | null
  ports: Record<string, { HostIp: string; HostPort: string }[] | null> | null
  exposed: Record<string, unknown> | null
  networks: Record<string, { IPAddress?: string; Aliases?: string[] | null }> | null
  netmode: string
  project: string | null
  service: string | null
}

const LOOPBACK = /^(127\.|::1$|localhost$)/

export function normIp(raw: string): string {
  let ip = raw.trim().replace(/^\[|\]$/g, '')
  ip = ip.replace(/%[\w.@-]+$/, '')
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7)
  if (ip === '*' || ip === '') return '0.0.0.0'
  if (ip === '::') return '0.0.0.0'
  return ip
}

export const isWildcard = (ip: string): boolean => ip === '0.0.0.0' || ip === '::'
export const isLoopback = (ip: string): boolean => LOOPBACK.test(ip)

function splitAddr(a: string): { ip: string; port: number } | null {
  const i = a.lastIndexOf(':')
  if (i < 0) return null
  const port = Number(a.slice(i + 1))
  if (!Number.isInteger(port)) return null
  return { ip: normIp(a.slice(0, i)), port }
}

function parseSockets(text: string, fmt: string): Sock[] {
  const out: Sock[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const tokens = line.trim().split(/\s+/)
    const addrs = tokens.filter((t) => /:(\d+|\*)$/.test(t) && !t.startsWith('users:'))
    if (addrs.length < 2) continue
    const l = splitAddr(addrs[0])
    const r = splitAddr(addrs[1].replace(/:\*$/, ':0'))
    if (!l || !r) continue
    const pids: Sock['pids'] = []
    if (fmt === 'ss') {
      for (const m of line.matchAll(/\("([^"]*)",pid=(\d+)/g))
        pids.push({ name: m[1], pid: Number(m[2]) })
    } else {
      const m = tokens[tokens.length - 1].match(/^(\d+)\/(.+)$/)
      if (m) pids.push({ pid: Number(m[1]), name: m[2] })
    }
    out.push({ lip: l.ip, lport: l.port, rip: r.ip, rport: r.port, pids })
  }
  return out
}

function parsePs(text: string): Map<number, Proc> {
  const map = new Map<number, Proc>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/)
    if (m) {
      map.set(Number(m[1]), {
        pid: Number(m[1]),
        ppid: Number(m[2]),
        user: m[3],
        comm: m[4],
        args: m[5] || m[4]
      })
    }
  }
  return map
}

interface CgInfo {
  containerId?: string
  k8s?: boolean
  unit?: string
}

function parseCgroups(text: string): Map<number, CgInfo> {
  const map = new Map<number, CgInfo>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\s+(.*)$/)
    if (!m) continue
    const cg = m[2]
    const info: CgInfo = {}
    const docker = cg.match(/(?:docker[-/]|\/docker\/|libpod-)([0-9a-f]{64})/)
    if (docker) info.containerId = docker[1]
    if (/kubepods/.test(cg)) {
      info.k8s = true
      const cri = cg.match(/(?:cri-containerd-|crio-|docker-)([0-9a-f]{64})/)
      if (cri) info.containerId = cri[1]
    }
    const unit = cg.match(/system\.slice\/([^/|]+)\.service/)
    if (unit && !info.containerId) info.unit = unit[1]
    map.set(Number(m[1]), info)
  }
  return map
}

function hexIp(h: string): string {
  if (h.length === 8) {
    return [6, 4, 2, 0].map((i) => parseInt(h.slice(i, i + 2), 16)).join('.')
  }
  if (h.length === 32) {
    const bytes: number[] = []
    for (let w = 0; w < 4; w++) {
      const word = h.slice(w * 8, w * 8 + 8)
      for (const i of [6, 4, 2, 0]) bytes.push(parseInt(word.slice(i, i + 2), 16))
    }
    if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 255 && bytes[11] === 255) {
      return bytes.slice(12).join('.')
    }
    if (bytes.every((b) => b === 0)) return '0.0.0.0'
    if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return '::1'
    const groups: string[] = []
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16))
    return groups.join(':')
  }
  return '0.0.0.0'
}

/** /proc/<pid>/net/tcp[6]:st 0A=LISTEN, 01=ESTABLISHED。 */
function parseProcTcp(text: string): { listen: { ip: string; port: number }[]; estab: Sock[] } {
  const listen: { ip: string; port: number }[] = []
  const estab: Sock[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^\s*\d+:\s+([0-9A-F]+):([0-9A-F]+)\s+([0-9A-F]+):([0-9A-F]+)\s+([0-9A-F]{2})/i
    )
    if (!m) continue
    const lip = normIp(hexIp(m[1]))
    const lport = parseInt(m[2], 16)
    const rip = normIp(hexIp(m[3]))
    const rport = parseInt(m[4], 16)
    if (m[5] === '0A') listen.push({ ip: lip, port: lport })
    else if (m[5] === '01') estab.push({ lip, lport, rip, rport, pids: [] })
  }
  return { listen, estab }
}

function parseIps(text: string): string[] {
  const ips = new Set<string>()
  for (const m of text.matchAll(/\binet6?\s+(?:addr:)?([0-9a-fA-F.:]+)/g)) {
    const ip = normIp(m[1])
    if (ip.startsWith('fe80')) continue
    ips.add(ip)
  }
  return [...ips]
}

const SCHEME_PORT: Record<string, number> = {
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
  grpc: 80,
  redis: 6379,
  rediss: 6379,
  mysql: 3306,
  'mysql+pymysql': 3306,
  mariadb: 3306,
  postgres: 5432,
  postgresql: 5432,
  'postgresql+psycopg2': 5432,
  'postgresql+asyncpg': 5432,
  mongodb: 27017,
  amqp: 5672,
  amqps: 5671,
  kafka: 9092,
  nats: 4222,
  mqtt: 1883,
  milvus: 19530,
  clickhouse: 8123
}

const KEY_PORT: [RegExp, number][] = [
  [/REDIS/, 6379],
  [/MYSQL|MARIADB/, 3306],
  [/POSTGRES|PG_|PGHOST|PSQL/, 5432],
  [/MONGO/, 27017],
  [/RABBIT|AMQP/, 5672],
  [/KAFKA/, 9092],
  [/MILVUS/, 19530],
  [/QDRANT/, 6333],
  [/ELASTIC|_ES_/, 9200],
  [/MINIO|S3_/, 9000],
  [/OLLAMA/, 11434]
]

/** 从容器环境变量里找出指向其它服务的地址;只保留 键名 + host:port,不保存任何值里的凭据。 */
function envRefs(env: string[]): { key: string; host: string; port: number }[] {
  const out: { key: string; host: string; port: number }[] = []
  const vars = new Map<string, string>()
  for (const e of env) {
    const i = e.indexOf('=')
    if (i > 0) vars.set(e.slice(0, i), e.slice(i + 1))
  }
  for (const [k, v] of vars) {
    if (!v || v.length > 2000) continue
    // 逗号分隔的多个地址(如 KAFKA_BROKERS)
    for (const part of v.split(/[,\s]+/).slice(0, 8)) {
      const url = part.match(
        /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/\s]*@)?(\[[^\]]+\]|[^:/?#,\s]+)(?::(\d+))?/i
      )
      if (url) {
        const scheme = url[1].toLowerCase()
        const port = Number(url[3]) || SCHEME_PORT[scheme]
        if (!port) continue
        out.push({ key: k, host: url[2].replace(/^\[|\]$/g, ''), port })
        continue
      }
      if (/HOST|ADDR|SERVER|ENDPOINT|URL|URI|BROKER/.test(k)) {
        const hp = part.match(/^([a-z0-9][a-z0-9._-]*):(\d{2,5})$/i)
        if (hp) {
          out.push({ key: k, host: hp[1], port: Number(hp[2]) })
          continue
        }
        if (
          /_HOST$|^HOST$|HOSTNAME$/.test(k) &&
          /^[a-z0-9][a-z0-9._-]*$/i.test(part) &&
          !/^\d+$/.test(part)
        ) {
          const prefix = k.replace(/_?HOST(NAME)?$/, '')
          const portVar = Number(vars.get(`${prefix}_PORT`) || vars.get(`${prefix}PORT`))
          const port = portVar || KEY_PORT.find(([re]) => re.test(k))?.[1]
          if (port) out.push({ key: k, host: part, port })
        }
      }
    }
  }
  const seen = new Set<string>()
  return out.filter((r) => {
    const id = `${r.key}|${r.host}|${r.port}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const IGNORED_REMOTE_PORTS = new Set([22])

export function parseDiscovery(
  output: string,
  host: { id: string; label: string; address: string }
): DiscoveryFacts {
  const s = sections(output, 'D')
  const get = (k: string): string => s.get(k) || ''
  const facts: DiscoveryFacts = {
    hostId: host.id,
    name: host.label,
    address: host.address,
    ips: [],
    discoveredAt: Date.now(),
    status: 'ok',
    docker: false,
    sudo: false,
    services: [],
    conns: [],
    refs: [],
    containers: []
  }
  if (!s.has('END')) {
    facts.status =
      /windows|^\d+\.\d+/i.test(output.trim()) || !s.has('ID') ? 'unsupported' : 'error'
    facts.error =
      facts.status === 'unsupported'
        ? '非 Linux 主机，暂不支持拓扑发现'
        : '发现脚本输出不完整（可能超时）'
    if (!s.has('ID')) return facts
  }
  const id = get('ID').split(/\r?\n/)
  facts.hostname = id[0]?.trim() || undefined
  facts.sudo = id[1]?.trim() === '0' || id[2]?.trim() === 'sudo'
  facts.ips = parseIps(get('IPS'))

  const fmtOf = (name: string): string =>
    [...s.keys()].find((k) => k.startsWith(`${name}:`))?.split(':')[1] || 'ss'
  const sectionOf = (name: string): string => s.get(`${name}:ss`) ?? s.get(`${name}:netstat`) ?? ''
  const listen = parseSockets(sectionOf('LISTEN'), fmtOf('LISTEN'))
  const estab = parseSockets(sectionOf('ESTAB'), fmtOf('ESTAB'))
  const procs = parsePs(get('PS'))
  const cgroups = parseCgroups(get('CGROUP'))
  const units = new Set(
    get('SYSTEMD')
      .split(/\r?\n/)
      .map((l) =>
        l
          .trim()
          .split(/\s+/)[0]
          ?.replace(/\.service$/, '')
      )
      .filter(Boolean)
  )

  // ---- GPU ----
  const gpuIndex = new Map<string, number>()
  for (const line of get('GPUS').split(/\r?\n/)) {
    const p = line.split(',').map((x) => x.trim())
    if (p[1]) gpuIndex.set(p[1], Number(p[0]))
  }
  const gpuApps = get('GPUAPPS')
    .split(/\r?\n/)
    .map((line) => line.split(',').map((x) => x.trim()))
    .filter((p) => /^\d+$/.test(p[0] || ''))
    .map((p) => ({ pid: Number(p[0]), mem: Number(p[1]) || 0, gpu: gpuIndex.get(p[2]) ?? p[2] }))

  // ---- Docker ----
  const inspects: DockerInspect[] = []
  for (const line of get('DOCKER').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try {
      inspects.push(JSON.parse(line))
    } catch {
      // 单行损坏跳过
    }
  }
  facts.docker = s.has('DOCKER')

  const services = new Map<string, RawService>()
  const pidKey = new Map<number, string>()
  const containerKey = new Map<string, string>()
  const containerNs = new Map<string, string>()

  const addPort = (svc: RawService, port: McPort): void => {
    // 已有「宿主端口 → 容器端口」映射时,同一个容器端口不再单独列出
    if (port.published) svc.ports = svc.ports.filter((p) => p.published || p.port !== port.port)
    else if (svc.ports.some((p) => p.published && p.port === port.port)) return
    const existing = svc.ports.find(
      (p) => p.port === port.port && (p.published ?? 0) === (port.published ?? 0)
    )
    if (!existing) svc.ports.push(port)
    else if (isWildcard(port.bind)) existing.bind = port.bind
  }
  const addListen = (svc: RawService, ip: string, port: number, ns: 'host' | 'container'): void => {
    if (!svc.listen.some((l) => l.ip === ip && l.port === port && l.ns === ns)) {
      svc.listen.push({ ip, port, ns })
    }
  }

  const findContainer = (cid: string): DockerInspect | undefined =>
    inspects.find((c) => c.id.startsWith(cid) || cid.startsWith(c.id))

  for (const c of inspects) {
    const name = c.name.replace(/^\//, '')
    const main = procs.get(c.pid)
    const args = [...(c.entrypoint || []), ...(c.cmd || [])].join(' ') || main?.args || ''
    const cls = classify(main?.comm || '', `${args} ${main?.args || ''}`, c.image)
    const key = `ctr:${name}`
    const meta: Record<string, unknown> = { image: c.image }
    if (c.project) meta.compose = `${c.project}/${c.service || ''}`
    if (cls.category === 'llm') Object.assign(meta, llmMeta(cls.kind, args, c.env || []))
    const tag = c.image.split(':')[1]
    if (cls.category === 'data' && tag && tag !== 'latest') meta.version = tag
    const svc: RawService = {
      key,
      category: cls.category === 'infra' ? 'app' : cls.category,
      kind: cls.kind,
      name,
      deploy: cgroups.get(c.pid)?.k8s ? 'k8s' : 'docker',
      containerId: c.id,
      containerName: name,
      image: c.image,
      composeProject: c.project || undefined,
      pid: c.pid || undefined,
      process: main?.comm,
      cmd: args.slice(0, 600),
      ports: [],
      listen: [],
      meta
    }
    services.set(key, svc)
    containerKey.set(c.id, key)
    if (c.pid) pidKey.set(c.pid, key)
    const hostNet = c.netmode === 'host'
    containerNs.set(c.id, hostNet ? 'host' : c.id)

    const ips = Object.values(c.networks || {})
      .map((n) => n?.IPAddress)
      .filter((x): x is string => !!x)
    const aliases = Object.values(c.networks || {}).flatMap((n) => n?.Aliases || [])
    if (c.service) aliases.push(c.service)
    facts.containers.push({
      id: c.id,
      name,
      ips,
      aliases: [...new Set(aliases.filter((a) => a && !/^[0-9a-f]{12}$/.test(a)))],
      serviceKey: key
    } satisfies RawContainer)

    if (!hostNet) {
      const tcp = parseProcTcp(get(`CTCP:${c.id}`))
      const listenPorts = new Set(tcp.listen.map((l) => l.port))
      // 读不到容器内 socket 表时退回镜像声明的 EXPOSE 端口
      if (!listenPorts.size) {
        for (const k of Object.keys(c.exposed || {})) {
          const m = k.match(/^(\d+)\/tcp$/)
          if (m) listenPorts.add(Number(m[1]))
        }
        for (const k of Object.keys(c.ports || {})) {
          const m = k.match(/^(\d+)\/tcp$/)
          if (m) listenPorts.add(Number(m[1]))
        }
      }
      for (const port of listenPorts) {
        const bind = tcp.listen.find((l) => l.port === port)?.ip ?? '0.0.0.0'
        if (isLoopback(bind)) continue
        addPort(svc, { port, bind })
        for (const ip of ips) addListen(svc, ip, port, 'container')
      }
      for (const [k, binds] of Object.entries(c.ports || {})) {
        const m = k.match(/^(\d+)\/tcp$/)
        if (!m || !binds) continue
        for (const b of binds) {
          const hostPort = Number(b.HostPort)
          if (!hostPort) continue
          const hip = normIp(b.HostIp || '0.0.0.0')
          addPort(svc, { port: Number(m[1]), bind: hip, published: hostPort })
          addListen(svc, hip, hostPort, 'host')
        }
      }
      // 容器内的出站连接
      const conns = new Map<string, RawConn>()
      for (const e of tcp.estab) {
        if (listenPorts.has(e.lport) || IGNORED_REMOTE_PORTS.has(e.rport)) continue
        const id = `${e.rip}:${e.rport}`
        const cur = conns.get(id)
        if (cur) cur.count++
        else conns.set(id, { from: key, ns: c.id, ip: e.rip, port: e.rport, count: 1 })
      }
      facts.conns.push(...conns.values())
    }

    for (const r of envRefs(c.env || [])) {
      facts.refs.push({
        from: key,
        ns: hostNet ? 'host' : c.id,
        kind: 'config',
        host: r.host,
        port: r.port,
        label: r.key,
        evidence: `环境变量 ${r.key} → ${r.host}:${r.port}`
      })
    }
  }

  // ---- 宿主机网络命名空间里的进程 ----
  const rootOf = (pid: number): Proc | undefined => {
    let p = procs.get(pid)
    if (!p) return undefined
    for (let i = 0; i < 20; i++) {
      const parent = procs.get(p.ppid)
      if (!parent || parent.pid <= 1 || parent.comm !== p.comm) break
      p = parent
    }
    return p
  }

  const deployOf = (pid: number): { deploy: McDeploy; unit?: string; containerId?: string } => {
    const cg = cgroups.get(pid)
    if (cg?.containerId) return { deploy: cg.k8s ? 'k8s' : 'docker', containerId: cg.containerId }
    if (cg?.k8s) return { deploy: 'k8s' }
    if (cg?.unit && units.has(cg.unit)) return { deploy: 'systemd', unit: cg.unit }
    if (cg?.unit) return { deploy: 'systemd', unit: cg.unit }
    return { deploy: 'process' }
  }

  /** pid → 服务键;没有就按「根进程」新建一个(clientOnly 表示仅因出站连接而建)。 */
  const serviceForPid = (pid: number, fallbackName: string, clientOnly: boolean): string | null => {
    const known = pidKey.get(pid)
    if (known) return known
    const d = deployOf(pid)
    if (d.containerId) {
      const c = findContainer(d.containerId)
      const k = c ? containerKey.get(c.id) : undefined
      if (k) {
        pidKey.set(pid, k)
        return k
      }
    }
    const root = rootOf(pid)
    const comm = root?.comm || fallbackName
    if (!comm) return null
    if (comm === 'docker-proxy' || comm === 'sshd') return null
    const args = root?.args || comm
    const cls = classify(comm, args)
    const key = d.unit
      ? `unit:${d.unit}`
      : `proc:${cls.kind === comm ? comm : cls.kind}:${friendlyName(cls.kind, comm, args)}`
    let svc = services.get(key)
    if (!svc) {
      const meta: Record<string, unknown> = cls.category === 'llm' ? llmMeta(cls.kind, args) : {}
      svc = {
        key,
        category: cls.category,
        kind: cls.kind,
        name:
          cls.category === 'app' || cls.category === 'infra'
            ? friendlyName(cls.kind, comm, args)
            : d.unit && !d.unit.startsWith(cls.kind)
              ? d.unit
              : cls.kind,
        deploy: d.deploy,
        unit: d.unit,
        pid: root?.pid ?? pid,
        process: comm,
        cmd: args.slice(0, 600),
        ports: [],
        listen: [],
        meta,
        clientOnly
      }
      services.set(key, svc)
    } else if (!clientOnly) svc.clientOnly = false
    pidKey.set(pid, key)
    if (root) pidKey.set(root.pid, key)
    return key
  }

  for (const sock of listen) {
    const p = sock.pids[0]
    let key: string | null = null
    if (p) key = serviceForPid(p.pid, p.name, false)
    else {
      // 无权限看到进程归属时,按端口建一个占位服务
      const guess = guessByPort(sock.lport)
      key = `port:${sock.lport}`
      if (!services.has(key)) {
        services.set(key, {
          key,
          category: guess.category === 'external' ? 'app' : guess.category,
          kind: guess.kind === 'tcp' || guess.kind === 'http' ? 'unknown' : guess.kind,
          name: `:${sock.lport}`,
          deploy: 'process',
          ports: [],
          listen: [],
          meta: { note: '无权限读取进程归属（需要 root 或免密 sudo）' }
        })
      }
    }
    if (!key) continue
    const svc = services.get(key)!
    svc.clientOnly = false
    if (!isLoopback(sock.lip) || !svc.ports.some((x) => x.port === sock.lport)) {
      addPort(svc, { port: sock.lport, bind: sock.lip })
    }
    addListen(svc, sock.lip, sock.lport, 'host')
  }

  // 宿主机网络命名空间里的出站连接
  const hostListenPorts = new Set(listen.map((l) => l.lport))
  const hostConns = new Map<string, RawConn>()
  for (const e of estab) {
    if (hostListenPorts.has(e.lport) || IGNORED_REMOTE_PORTS.has(e.rport)) continue
    const p = e.pids[0]
    if (!p) continue
    const key = serviceForPid(p.pid, p.name, true)
    if (!key) continue
    const id = `${key}|${e.rip}:${e.rport}`
    const cur = hostConns.get(id)
    if (cur) cur.count++
    else hostConns.set(id, { from: key, ns: 'host', ip: e.rip, port: e.rport, count: 1 })
  }
  facts.conns.push(...hostConns.values())

  // ---- GPU 绑定 ----
  for (const app of gpuApps) {
    const key = pidKey.get(app.pid) ?? serviceForPid(app.pid, '', true)
    const svc = key ? services.get(key) : undefined
    if (!svc) continue
    const list = (svc.meta.gpus as { gpu: number | string; memMiB: number }[] | undefined) ?? []
    list.push({ gpu: app.gpu, memMiB: app.mem })
    svc.meta.gpus = list
    // 有 GPU 进程但没有监听端口的(如训练任务)也值得在图上出现
    svc.clientOnly = false
  }

  // ---- nginx 反向代理 ----
  const nginxRefs = (text: string, from: string, ns: string): void => {
    const routes = parseNginx(text)
    const svc = services.get(from)
    if (svc) {
      svc.meta.routes = routes.slice(0, 120).map((r: NginxRoute) => ({
        serverName: r.serverName,
        listen: r.listen.join(','),
        location: r.location,
        target: r.target
      }))
    }
    for (const r of routes) {
      const label = `${r.serverName || '_'} ${r.location}`.trim()
      facts.refs.push({
        from,
        ns,
        kind: 'proxy',
        host: r.host,
        port: r.port,
        label,
        evidence: `${r.serverName ? `server_name ${r.serverName} ` : ''}location ${r.location} → ${r.directive} ${r.target}`
      })
    }
  }
  const hostNginx = get('NGINX')
  if (hostNginx.trim()) {
    let key = [...services.values()].find(
      (x) =>
        x.category === 'gateway' &&
        x.deploy !== 'docker' &&
        x.deploy !== 'k8s' &&
        /nginx|openresty|tengine/.test(x.kind)
    )?.key
    if (!key) {
      key = 'proc:nginx'
      services.set(key, {
        key,
        category: 'gateway',
        kind: 'nginx',
        name: 'nginx',
        deploy: units.has('nginx') ? 'systemd' : 'process',
        unit: units.has('nginx') ? 'nginx' : undefined,
        ports: nginxListenPorts(hostNginx).map((port) => ({ port, bind: '0.0.0.0' })),
        listen: nginxListenPorts(hostNginx).map((port) => ({
          ip: '0.0.0.0',
          port,
          ns: 'host' as const
        })),
        meta: {}
      })
    }
    nginxRefs(hostNginx, key, 'host')
  }
  for (const [k, text] of s) {
    if (!k.startsWith('NGINXC:') || !text.trim()) continue
    const c = findContainer(k.slice(7))
    const key = c ? containerKey.get(c.id) : undefined
    if (c && key) nginxRefs(text, key, containerNs.get(c.id) || c.id)
  }

  // 有 ss 输出却没有 -p 信息时,提示用户
  if (listen.length && listen.every((l) => !l.pids.length)) {
    facts.error =
      '当前用户无法读取端口所属进程（建议使用 root 或配置免密 sudo），部分服务只能按端口识别'
  }

  facts.services = [...services.values()].map((svc) => {
    svc.ports.sort((a, b) => a.port - b.port)
    if (svc.category === 'llm' && !svc.meta.port) {
      const def = Number(svc.meta.defaultPort)
      const p = svc.ports.find((x) => x.port === def) ?? svc.ports[0]
      if (p) svc.meta.port = p.published ?? p.port
    }
    return svc
  })
  return facts
}
