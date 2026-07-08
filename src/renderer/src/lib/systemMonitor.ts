export interface SystemStats {
  cpuPercent: number | null
  memPercent: number | null
  memUsedMb: number | null
  memTotalMb: number | null
  diskPercent: number | null
  diskUsed: string | null
  diskTotal: string | null
  load: string | null
  uptime: string | null
}

// Single round-trip probe; sections are delimited so we can parse robustly.
export const MONITOR_COMMAND = [
  'echo ===LOAD===',
  'cat /proc/loadavg 2>/dev/null',
  'echo ===UPTIME===',
  'uptime -p 2>/dev/null',
  'echo ===MEM===',
  'free -m 2>/dev/null',
  'echo ===DISK===',
  'df -h / 2>/dev/null',
  'echo ===CPU===',
  "top -bn1 2>/dev/null | grep -i cpu | head -1"
].join('; ')

function section(output: string, name: string): string {
  const start = output.indexOf(`===${name}===`)
  if (start === -1) return ''
  const from = output.indexOf('\n', start)
  if (from === -1) return ''
  const nextMarker = output.indexOf('\n===', from)
  return output.slice(from + 1, nextMarker === -1 ? undefined : nextMarker).trim()
}

export function parseMonitorOutput(output: string): SystemStats {
  const stats: SystemStats = {
    cpuPercent: null,
    memPercent: null,
    memUsedMb: null,
    memTotalMb: null,
    diskPercent: null,
    diskUsed: null,
    diskTotal: null,
    load: null,
    uptime: null
  }

  const load = section(output, 'LOAD')
  if (load) {
    const parts = load.split(/\s+/)
    if (parts.length >= 3) stats.load = `${parts[0]} ${parts[1]} ${parts[2]}`
  }

  const uptime = section(output, 'UPTIME')
  if (uptime) stats.uptime = uptime.replace(/^up\s+/, '')

  const mem = section(output, 'MEM')
  if (mem) {
    const memLine = mem.split('\n').find((l) => /^Mem:/i.test(l.trim()))
    if (memLine) {
      const t = memLine.trim().split(/\s+/)
      const total = Number(t[1])
      const used = Number(t[2])
      if (!Number.isNaN(total) && !Number.isNaN(used) && total > 0) {
        stats.memTotalMb = total
        stats.memUsedMb = used
        stats.memPercent = Math.round((used / total) * 100)
      }
    }
  }

  const disk = section(output, 'DISK')
  if (disk) {
    const diskLine = disk.split('\n')[1] ?? disk.split('\n')[0]
    if (diskLine) {
      const d = diskLine.trim().split(/\s+/)
      if (d.length >= 5) {
        stats.diskTotal = d[1]
        stats.diskUsed = d[2]
        const pct = Number(d[4].replace('%', ''))
        if (!Number.isNaN(pct)) stats.diskPercent = pct
      }
    }
  }

  const cpu = section(output, 'CPU')
  if (cpu) {
    // Try to find the idle value (e.g. "96.5 id") and derive usage.
    const idleMatch = cpu.match(/([\d.]+)\s*%?\s*id/i)
    if (idleMatch) {
      const idle = Number(idleMatch[1])
      if (!Number.isNaN(idle)) stats.cpuPercent = Math.max(0, Math.round(100 - idle))
    }
  }

  return stats
}
