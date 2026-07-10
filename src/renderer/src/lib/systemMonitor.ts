/**
 * 系统监控数据采集与解析。
 *
 * 一次 SSH exec 往返采齐所有监控项;CPU 每核心占用、网络速率、磁盘 IO 速率都需要「增量」,
 * 因此在同一条命令里对 /proc 采样两次(中间 sleep 1s),解析时做差,速率 = 差值 / 采样间隔。
 * 所有字段都可空(null),缺失时 UI 优雅降级,不因某台机器缺少某个文件而整体报错。
 */

/** /proc 两次采样之间的间隔秒数(命令里的 sleep 1)。 */
const SAMPLE_INTERVAL = 1

export interface SysInfo {
  ip: string | null
  osName: string | null // 发行版名,如 "Ubuntu"
  osVersion: string | null // 版本,如 "24.04.3 LTS (Noble Numbat)"
  tz: string | null // 时区,如 "GMT+0800 CST"
  uptimeSec: number | null
}

export interface CpuStat {
  overall: number | null // 0-100
  cores: number[] // 每核心 0-100,顺序即 cpu0,cpu1,...
}

export interface MemStat {
  totalMb: number
  usedMb: number
  cacheMb: number
  freeMb: number
  availMb: number
  percent: number // 已用占比 0-100
}

export interface NetStat {
  upBps: number // 上传速率 字节/秒
  downBps: number // 下载速率 字节/秒
  upTotal: number // 累计上传 字节(自开机)
  downTotal: number // 累计下载 字节
}

export interface DiskMount {
  mount: string
  fstype: string
  sizeB: number
  usedB: number
  availB: number
  percent: number
}

export interface DiskStat {
  mounts: DiskMount[]
  readBps: number // 聚合读速率 字节/秒
  writeBps: number // 聚合写速率 字节/秒
  totalSizeB: number // 所有挂载总容量
  totalUsedB: number // 所有挂载已用
}

export interface ProcInfo {
  pid: number
  user: string
  stat: string
  cpu: number // %
  mem: number // %
  startEpoch: number | null // 秒级时间戳
  cmd: string
}

export interface SystemStats {
  sys: SysInfo
  cpu: CpuStat
  mem: MemStat | null
  net: NetStat | null
  disk: DiskStat
  procs: ProcInfo[]
}

// 单次往返探针;各段以 ===NAME=== 分隔,便于稳健解析。
// 两次 STAT/NET/DIO 采样之间 sleep 1s 用于计算增量速率。
export const MONITOR_COMMAND = [
  'echo ===OS===',
  "grep -E '^(PRETTY_NAME|NAME|VERSION)=' /etc/os-release 2>/dev/null",
  'echo ===IP===',
  'hostname -I 2>/dev/null',
  'echo ===TZ===',
  "date +'%Z|%z' 2>/dev/null",
  'echo ===UPTIME===',
  'cat /proc/uptime 2>/dev/null',
  'echo ===MEM===',
  "grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SReclaimable):' /proc/meminfo 2>/dev/null",
  'echo ===DISK===',
  "df -T -B1 2>/dev/null | grep -E '^/dev/'",
  'echo ===STAT1===',
  "grep -E '^cpu' /proc/stat 2>/dev/null",
  'echo ===NET1===',
  'cat /proc/net/dev 2>/dev/null',
  'echo ===DIO1===',
  'cat /proc/diskstats 2>/dev/null',
  `sleep ${SAMPLE_INTERVAL}`,
  'echo ===STAT2===',
  "grep -E '^cpu' /proc/stat 2>/dev/null",
  'echo ===NET2===',
  'cat /proc/net/dev 2>/dev/null',
  'echo ===DIO2===',
  'cat /proc/diskstats 2>/dev/null',
  'echo ===PROC===',
  'ps -eo pid,user,stat,pcpu,pmem,etimes,args --sort=-pcpu 2>/dev/null | head -n 60'
].join('; ')

function section(output: string, name: string): string {
  const start = output.indexOf(`===${name}===`)
  if (start === -1) return ''
  const from = output.indexOf('\n', start)
  if (from === -1) return ''
  const nextMarker = output.indexOf('\n===', from)
  return output.slice(from + 1, nextMarker === -1 ? undefined : nextMarker).trim()
}

/** /etc/os-release 的 KEY=VALUE(值可能带引号)。 */
function osReleaseValue(block: string, key: string): string | null {
  const line = block.split('\n').find((l) => l.startsWith(`${key}=`))
  if (!line) return null
  return (
    line
      .slice(key.length + 1)
      .replace(/^"(.*)"$/, '$1')
      .trim() || null
  )
}

function parseSys(output: string): SysInfo {
  const os = section(output, 'OS')
  const pretty = osReleaseValue(os, 'PRETTY_NAME')
  const name = osReleaseValue(os, 'NAME')
  let osName: string | null = name
  let osVersion: string | null = osReleaseValue(os, 'VERSION')
  // 从 PRETTY_NAME 里拆出「发行版名 + 其余(版本)」,更贴近截图的展示。
  if (pretty) {
    if (name && pretty.startsWith(name)) {
      osName = name
      osVersion = pretty.slice(name.length).trim() || osVersion
    } else {
      const sp = pretty.indexOf(' ')
      osName = sp === -1 ? pretty : pretty.slice(0, sp)
      osVersion = sp === -1 ? osVersion : pretty.slice(sp + 1)
    }
  }

  const ipRaw = section(output, 'IP')
  const ip =
    ipRaw
      .split(/\s+/)
      .find((a) => a && a !== '127.0.0.1' && !a.startsWith('::') && !a.startsWith('fe80')) ?? null

  // "CST|+0800" → "GMT+0800 CST"
  let tz: string | null = null
  const tzRaw = section(output, 'TZ')
  if (tzRaw) {
    const [abbr, offset] = tzRaw.split('|')
    if (offset) tz = `GMT${offset}${abbr ? ` ${abbr}` : ''}`
    else if (abbr) tz = abbr
  }

  let uptimeSec: number | null = null
  const up = section(output, 'UPTIME').split(/\s+/)[0]
  if (up) {
    const n = Number(up)
    if (!Number.isNaN(n)) uptimeSec = Math.floor(n)
  }

  return { ip, osName, osVersion, tz, uptimeSec }
}

/** 解析一段 /proc/stat 的 cpu* 行为 { name: [fields...] }。 */
function parseStat(block: string): Record<string, number[]> {
  const map: Record<string, number[]> = {}
  for (const line of block.split('\n')) {
    const t = line.trim().split(/\s+/)
    if (!/^cpu/.test(t[0])) continue
    map[t[0]] = t.slice(1).map(Number)
  }
  return map
}

function cpuUsage(a: number[] | undefined, b: number[] | undefined): number | null {
  if (!a || !b) return null
  const idleA = (a[3] ?? 0) + (a[4] ?? 0) // idle + iowait
  const idleB = (b[3] ?? 0) + (b[4] ?? 0)
  const totalA = a.reduce((s, v) => s + (v || 0), 0)
  const totalB = b.reduce((s, v) => s + (v || 0), 0)
  const dTotal = totalB - totalA
  if (dTotal <= 0) return null
  const usage = 100 * (1 - (idleB - idleA) / dTotal)
  return Math.max(0, Math.min(100, Math.round(usage * 10) / 10))
}

function parseCpu(output: string): CpuStat {
  const s1 = parseStat(section(output, 'STAT1'))
  const s2 = parseStat(section(output, 'STAT2'))
  const overall = cpuUsage(s1['cpu'], s2['cpu'])
  const cores: number[] = []
  for (let i = 0; ; i++) {
    const key = `cpu${i}`
    if (!(key in s2)) break
    cores.push(cpuUsage(s1[key], s2[key]) ?? 0)
  }
  return { overall, cores }
}

function parseMem(output: string): MemStat | null {
  const block = section(output, 'MEM')
  if (!block) return null
  const kb: Record<string, number> = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/)
    if (m) kb[m[1]] = Number(m[2])
  }
  const total = kb.MemTotal
  if (!total) return null
  const free = kb.MemFree ?? 0
  const cache = (kb.Buffers ?? 0) + (kb.Cached ?? 0) + (kb.SReclaimable ?? 0)
  const avail = kb.MemAvailable ?? free + cache
  const used = Math.max(0, total - free - cache)
  const toMb = (v: number): number => Math.round(v / 1024)
  return {
    totalMb: toMb(total),
    usedMb: toMb(used),
    cacheMb: toMb(cache),
    freeMb: toMb(free),
    availMb: toMb(avail),
    percent: Math.round((used / total) * 100)
  }
}

/** /proc/net/dev:累计 rx/tx 字节,聚合所有非 lo 接口。返回 [rxBytes, txBytes]。 */
function netTotals(block: string): [number, number] {
  let rx = 0
  let tx = 0
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const iface = line.slice(0, idx).trim()
    if (!iface || iface === 'lo') continue
    const f = line
      .slice(idx + 1)
      .trim()
      .split(/\s+/)
      .map(Number)
    rx += f[0] || 0 // rx_bytes
    tx += f[8] || 0 // tx_bytes
  }
  return [rx, tx]
}

function parseNet(output: string): NetStat | null {
  const b1 = section(output, 'NET1')
  const b2 = section(output, 'NET2')
  if (!b1 || !b2) return null
  const [rx1, tx1] = netTotals(b1)
  const [rx2, tx2] = netTotals(b2)
  return {
    downBps: Math.max(0, (rx2 - rx1) / SAMPLE_INTERVAL),
    upBps: Math.max(0, (tx2 - tx1) / SAMPLE_INTERVAL),
    downTotal: rx2,
    upTotal: tx2
  }
}

const WHOLE_DISK_RE = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/

/** /proc/diskstats:聚合整盘设备(排除分区)的 sectorsRead[5]/sectorsWritten[9],扇区=512B。 */
function diskIoTotals(block: string): [number, number] {
  let read = 0
  let write = 0
  for (const line of block.split('\n')) {
    const t = line.trim().split(/\s+/)
    const name = t[2]
    if (!name || !WHOLE_DISK_RE.test(name)) continue
    read += (Number(t[5]) || 0) * 512
    write += (Number(t[9]) || 0) * 512
  }
  return [read, write]
}

function parseDisk(output: string): DiskStat {
  const mounts: DiskMount[] = []
  let totalSizeB = 0
  let totalUsedB = 0
  for (const line of section(output, 'DISK').split('\n')) {
    const t = line.trim().split(/\s+/)
    // Filesystem Type 1B-blocks Used Avail Use% Mounted
    if (t.length < 7) continue
    const sizeB = Number(t[2])
    const usedB = Number(t[3])
    const availB = Number(t[4])
    const percent = Number(t[5].replace('%', ''))
    if (Number.isNaN(sizeB)) continue
    mounts.push({
      mount: t.slice(6).join(' '),
      fstype: t[1],
      sizeB,
      usedB,
      availB,
      percent: Number.isNaN(percent) ? 0 : percent
    })
    totalSizeB += sizeB
    totalUsedB += usedB
  }

  const d1 = section(output, 'DIO1')
  const d2 = section(output, 'DIO2')
  let readBps = 0
  let writeBps = 0
  if (d1 && d2) {
    const [r1, w1] = diskIoTotals(d1)
    const [r2, w2] = diskIoTotals(d2)
    readBps = Math.max(0, (r2 - r1) / SAMPLE_INTERVAL)
    writeBps = Math.max(0, (w2 - w1) / SAMPLE_INTERVAL)
  }
  return { mounts, readBps, writeBps, totalSizeB, totalUsedB }
}

// 进程列表专用命令(供「查看全部」弹窗独立刷新,不带 sleep 采样开销)。
export const PROC_COMMAND =
  'ps -eo pid,user,stat,pcpu,pmem,etimes,args --sort=-pcpu 2>/dev/null | head -n 400'

/** 解析 `ps -eo pid,user,stat,pcpu,pmem,etimes,args` 的输出为进程列表(前 6 列单值,其余为命令)。 */
export function parseProcList(raw: string): ProcInfo[] {
  const now = Date.now() / 1000
  const procs: ProcInfo[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim().split(/\s+/)
    if (t.length < 7) continue
    const pid = Number(t[0])
    if (Number.isNaN(pid)) continue // 跳过表头/杂行
    const etimes = Number(t[5])
    procs.push({
      pid,
      user: t[1],
      stat: t[2],
      cpu: Number(t[3]) || 0,
      mem: Number(t[4]) || 0,
      startEpoch: Number.isNaN(etimes) ? null : Math.round(now - etimes),
      cmd: t.slice(6).join(' ')
    })
  }
  return procs
}

function parseProcs(output: string): ProcInfo[] {
  return parseProcList(section(output, 'PROC'))
}

export function parseMonitorOutput(output: string): SystemStats {
  return {
    sys: parseSys(output),
    cpu: parseCpu(output),
    mem: parseMem(output),
    net: parseNet(output),
    disk: parseDisk(output),
    procs: parseProcs(output)
  }
}
