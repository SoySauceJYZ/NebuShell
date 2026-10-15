// 无 Agent 主机资源采集:一条 Linux 复合命令 / 一段 PowerShell,移植自 resource-monitor/server/physical-monitor.js。
import { num, round, sections } from '../util'

export const LINUX_COMMAND = String.raw`printf '__RM_HOST__\n'; hostname 2>/dev/null; printf '__RM_OS__\n'; (grep -E '^(PRETTY_NAME|NAME)=' /etc/os-release 2>/dev/null | head -1 || true); printf '__RM_KERNEL__\n'; uname -r 2>/dev/null; printf '__RM_CPU__\n'; (grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- || uname -m); printf '__RM_CORES__\n'; (getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c '^processor' /proc/cpuinfo); printf '__RM_MEM__\n'; cat /proc/meminfo 2>/dev/null; printf '__RM_STAT1__\n'; head -1 /proc/stat 2>/dev/null; printf '__RM_NET1__\n'; cat /proc/net/dev 2>/dev/null; sleep 1; printf '__RM_STAT2__\n'; head -1 /proc/stat 2>/dev/null; printf '__RM_NET2__\n'; cat /proc/net/dev 2>/dev/null; printf '__RM_LOAD__\n'; cat /proc/loadavg 2>/dev/null; printf '__RM_UPTIME__\n'; cat /proc/uptime 2>/dev/null; printf '__RM_DF__\n'; (df -P -B1 2>/dev/null || df -Pk 2>/dev/null); printf '__RM_GPU__\n'; if command -v nvidia-smi >/dev/null 2>&1; then nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits 2>/dev/null; fi; printf '__RM_GPUOPTIONAL__\n'; if command -v nvidia-smi >/dev/null 2>&1; then nvidia-smi --query-gpu=index,pstate,utilization.memory --format=csv,noheader,nounits 2>/dev/null || true; fi; printf '__RM_END__\n'`

const WINDOWS_SCRIPT = String.raw`$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $cpu=@(Get-CimInstance Win32_Processor); $disks=@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {[pscustomobject]@{mount=$_.DeviceID;total=[int64]$_.Size;used=[int64]($_.Size-$_.FreeSpace)}}); $net=@(Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface | Measure-Object BytesReceivedPersec -Sum,BytesSentPersec -Sum); $rx=[double](($net | Where-Object {$_.Property -eq 'BytesReceivedPersec'}).Sum); $tx=[double](($net | Where-Object {$_.Property -eq 'BytesSentPersec'}).Sum); $g=@(); $go=@(); $n=(Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue); if($n){$g=@(& $n.Source --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits 2>$null); $go=@(& $n.Source --query-gpu=index,pstate,utilization.memory --format=csv,noheader,nounits 2>$null)}; [pscustomobject]@{hostname=$env:COMPUTERNAME;os=$os.Caption;kernel=$os.Version;cpuModel=($cpu.Name -join ' / ');cpuCores=($cpu|Measure-Object NumberOfCores -Sum).Sum;cpuThreads=($cpu|Measure-Object NumberOfLogicalProcessors -Sum).Sum;cpuPercent=($cpu|Measure-Object LoadPercentage -Average).Average;memoryTotal=[int64]$os.TotalVisibleMemorySize*1024;memoryUsed=([int64]$os.TotalVisibleMemorySize-[int64]$os.FreePhysicalMemory)*1024;uptime=[int64]((Get-Date)-$os.LastBootUpTime).TotalSeconds;disks=$disks;netRx=$rx;netTx=$tx;gpu=$g;gpuOptional=$go}|ConvertTo-Json -Depth 5 -Compress`

export const WINDOWS_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')}`

export const IDENTITY_COMMAND =
  'uname -s 2>/dev/null || powershell -NoProfile -NonInteractive -Command "$PSVersionTable.PSVersion.ToString()"'

export interface Gpu {
  index: number | null
  model: string | null
  util: number | null
  memoryUtil: number | null
  vramUsed: number | null
  vramTotal: number | null
  temp: number | null
  power: number | null
  fan: number | null
  pstate: string | null
  health: 'normal' | 'warn' | 'critical' | 'unknown'
  unified: boolean
}

export interface Disk {
  mount: string
  kind: string
  total: number | null
  used: number | null
  usedPct: number | null
}

export interface Hardware {
  hostname: string | null
  osName: string | null
  kernel: string | null
  cpuModel: string | null
  cpuCores: number | null
  cpuThreads: number | null
  memoryTotal: number | null
  gpus: Gpu[]
  disks: Disk[]
}

export interface Metric {
  cpuPercent: number | null
  memoryUsed: number | null
  memoryTotal: number | null
  load1: number | null
  uptime: number | null
  disks: Disk[]
  networkRxBps: number | null
  networkTxBps: number | null
  gpus: Gpu[]
}

export interface CollectResult {
  osType: 'linux' | 'windows'
  hardware: Hardware
  metric: Metric
}

function cpuPercent(a?: string, b?: string): number | null {
  const parse = (line?: string): number[] =>
    String(line || '')
      .trim()
      .split(/\s+/)
      .slice(1)
      .map(Number)
  const x = parse(a)
  const y = parse(b)
  if (x.length < 4 || y.length < 4) return null
  const totalA = x.reduce((s, v) => s + (v || 0), 0)
  const totalB = y.reduce((s, v) => s + (v || 0), 0)
  const idleA = (x[3] || 0) + (x[4] || 0)
  const idleB = (y[3] || 0) + (y[4] || 0)
  return totalB > totalA ? round((1 - (idleB - idleA) / (totalB - totalA)) * 100) : null
}

function netTotals(text?: string): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/)
    if (match && match[1].trim() !== 'lo') {
      rx += Number(match[2])
      tx += Number(match[3])
    }
  }
  return { rx, tx }
}

export function parseGpus(text?: string, optionalText?: string): Gpu[] {
  const optional = new Map(
    String(optionalText || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const p = line.split(',').map((x) => x.trim())
        return [
          num(p[0]),
          {
            pstate: /^(?:N\/A|\[Not Supported\])$/i.test(p[1]) ? null : p[1] || null,
            memoryUtil: num(p[2])
          }
        ] as const
      })
  )
  return String(text || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const p = line.split(',').map((x) => x.trim())
      const index = num(p[0])
      const used = num(p[3])
      const total = num(p[4])
      const temp = num(p[5])
      const extra = optional.get(index)
      return {
        index,
        model: p[1] || null,
        util: num(p[2]),
        memoryUtil: extra?.memoryUtil ?? null,
        vramUsed: used == null ? null : round(used / 1024, 2),
        vramTotal: total == null ? null : round(total / 1024, 2),
        temp,
        power: num(p[6]),
        fan: num(p[7]),
        pstate: extra?.pstate ?? null,
        health: temp == null ? 'unknown' : temp >= 90 ? 'critical' : temp >= 80 ? 'warn' : 'normal',
        unified: /\bGB10\b/i.test(p[1] || '') && used == null && total == null
      }
    })
}

export function parseLinux(output: string): CollectResult {
  const s = sections(output, 'RM')
  const get = (k: string): string => (s.get(k) || '').trim()
  if (!s.has('END') && !s.has('HOST')) throw new Error('Linux 采集输出标记缺失')
  const mem: Record<string, number> = {}
  for (const line of get('MEM').split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s+(\d+)/)
    if (m) mem[m[1]] = Number(m[2]) * 1024
  }
  const disks: Disk[] = []
  for (const line of get('DF').split(/\r?\n/).slice(1)) {
    const p = line.trim().split(/\s+/)
    if (p.length < 6 || !/^\d+$/.test(p[1])) continue
    const scale = Number(p[1]) < 100000000 ? 1024 : 1
    disks.push({
      mount: p.slice(5).join(' '),
      kind: p[0],
      total: Number(p[1]) * scale,
      used: Number(p[2]) * scale,
      usedPct: num(p[4]?.replace('%', ''))
    })
  }
  const n1 = netTotals(get('NET1'))
  const n2 = netTotals(get('NET2'))
  const gpus = parseGpus(get('GPU'), get('GPUOPTIONAL'))
  return {
    osType: 'linux',
    hardware: {
      hostname: get('HOST') || null,
      osName: get('OS')
        .replace(/^[^=]+=/, '')
        .replace(/^['"]|['"]$/g, ''),
      kernel: get('KERNEL') || null,
      cpuModel: get('CPU') || null,
      cpuCores: num(get('CORES')),
      cpuThreads: num(get('CORES')),
      memoryTotal: mem.MemTotal || null,
      gpus,
      disks
    },
    metric: {
      cpuPercent: cpuPercent(get('STAT1'), get('STAT2')),
      memoryUsed: mem.MemTotal && mem.MemAvailable != null ? mem.MemTotal - mem.MemAvailable : null,
      memoryTotal: mem.MemTotal || null,
      load1: num(get('LOAD').split(/\s+/)[0]),
      uptime: num(get('UPTIME').split(/\s+/)[0]),
      disks,
      networkRxBps: Math.max(0, n2.rx - n1.rx),
      networkTxBps: Math.max(0, n2.tx - n1.tx),
      gpus
    }
  }
}

export interface NetSample {
  at: number
  rx: number
  tx: number
}

export function parseWindows(
  output: string,
  prev: NetSample | null
): CollectResult & { sample: NetSample } {
  let value: Record<string, unknown>
  try {
    value = JSON.parse(output.trim())
  } catch {
    throw new Error('Windows PowerShell JSON 解析失败')
  }
  const now = Date.now()
  const seconds = prev ? (now - prev.at) / 1000 : 0
  const rates =
    prev && seconds > 0
      ? {
          rx: Math.max(0, (Number(value.netRx) - prev.rx) / seconds),
          tx: Math.max(0, (Number(value.netTx) - prev.tx) / seconds)
        }
      : { rx: null, tx: null }
  const sample = { at: now, rx: Number(value.netRx) || 0, tx: Number(value.netTx) || 0 }
  const lines = (v: unknown): string => (Array.isArray(v) ? v.join('\n') : String(v ?? ''))
  const gpus = parseGpus(lines(value.gpu), lines(value.gpuOptional))
  const rawDisks = Array.isArray(value.disks) ? (value.disks as Record<string, unknown>[]) : []
  const disks: Disk[] = rawDisks.map((d) => {
    const total = num(d.total)
    const used = num(d.used)
    return {
      mount: String(d.mount),
      kind: 'LogicalDisk',
      total,
      used,
      usedPct: total && used != null ? round((used / total) * 100) : null
    }
  })
  return {
    osType: 'windows',
    sample,
    hardware: {
      hostname: (value.hostname as string) || null,
      osName: (value.os as string) || null,
      kernel: (value.kernel as string) || null,
      cpuModel: (value.cpuModel as string) || null,
      cpuCores: num(value.cpuCores),
      cpuThreads: num(value.cpuThreads),
      memoryTotal: num(value.memoryTotal),
      gpus,
      disks
    },
    metric: {
      cpuPercent: num(value.cpuPercent),
      memoryUsed: num(value.memoryUsed),
      memoryTotal: num(value.memoryTotal),
      load1: null,
      uptime: num(value.uptime),
      disks,
      networkRxBps: rates.rx,
      networkTxBps: rates.tx,
      gpus
    }
  }
}
