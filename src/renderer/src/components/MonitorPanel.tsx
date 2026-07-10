import { useEffect, useState, useCallback } from 'react'
import {
  Server,
  Cpu,
  MemoryStick,
  Globe,
  HardDrive,
  ListTree,
  X,
  RefreshCw,
  Search,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import {
  MONITOR_COMMAND,
  PROC_COMMAND,
  parseMonitorOutput,
  parseProcList,
  type SystemStats,
  type ProcInfo,
  type MemStat
} from '../lib/systemMonitor'

// 采样历史点数(用于折线图)。
const HISTORY_LEN = 40
const POLL_MS = 3000

// ---- 格式化 ------------------------------------------------------------------
function fmtBytes(b: number): string {
  if (b < 1024) return `${Math.round(b)} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} G`
}
function fmtRate(bps: number): string {
  return `${fmtBytes(bps)}/s`
}
function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${Math.round(mb)}M`
}
function fmtUptime(sec: number | null): string {
  if (sec == null) return '-'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d} 天${h > 0 ? ` ${h} 时` : ''}`
  if (h > 0) return `${h} 时 ${m} 分`
  return `${m} 分`
}
function fmtStart(epoch: number | null): string {
  if (epoch == null) return '-'
  const dt = new Date(epoch * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`
}
// 负载分色:与主题一致,低=accent,中=琥珀,高=danger。
function loadColor(v: number): string {
  return v >= 85 ? 'var(--danger)' : v >= 60 ? '#d68a3d' : 'var(--accent)'
}

// ---- 图形基元 ----------------------------------------------------------------
function Sparkline({
  data,
  color,
  width = 130,
  height = 34
}: {
  data: number[]
  color: string
  width?: number
  height?: number
}): React.ReactElement {
  if (data.length < 2) {
    return <svg width={width} height={height} />
  }
  const max = Math.max(...data, 1e-6)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const x = (i: number): number => (i / (data.length - 1)) * width
  const y = (v: number): number => height - ((v - min) / range) * (height - 3) - 1.5
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `0,${height} ${line} ${width},${height}`
  const gid = `spark-${color.replace(/[^a-z]/gi, '')}`
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Donut({
  segments,
  size = 76,
  thickness = 13
}: {
  segments: { value: number; color: string }[]
  size?: number
  thickness?: number
}): React.ReactElement {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  // 纯函数式计算每段弧长与前缀偏移,避免在渲染期改写外层变量。
  const lengths = segments.map((s) => (s.value / total) * c)
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--content-bg)"
          strokeWidth={thickness}
        />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${lengths[i]} ${c - lengths[i]}`}
            strokeDashoffset={-offsets[i]}
          />
        ))}
      </g>
    </svg>
  )
}

// 每核心占用条(填充比例 + 数值)。
function CoreBar({ index, value }: { index: number; value: number }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 shrink-0 text-right font-mono text-[10px] text-[var(--text-muted)]">
        {index}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--content-bg)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, value)}%`, background: loadColor(value) }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[10px] text-[var(--text-dark)]">
        {value.toFixed(1)}
      </span>
    </div>
  )
}

// ---- 卡片外壳 ----------------------------------------------------------------
function Card({
  icon: Icon,
  title,
  badge,
  children
}: {
  icon: typeof Server
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon size={15} strokeWidth={1.9} className="text-[var(--accent)]" />
        <span className="text-[13px] font-semibold text-[var(--text-dark)]">{title}</span>
        {badge != null && <div className="ml-auto">{badge}</div>}
      </div>
      {children}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]">
      {children}
    </span>
  )
}

// ---- 各监控卡片 --------------------------------------------------------------
function SystemCard({ stats }: { stats: SystemStats }): React.ReactElement {
  const { sys } = stats
  return (
    <Card icon={Server} title="系统" badge={sys.ip ? <Badge>{sys.ip}</Badge> : undefined}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {sys.osName && (
          <span className="rounded-md border border-[var(--panel-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-dark)]">
            {sys.osName}
          </span>
        )}
        {sys.osVersion && (
          <span className="truncate text-[11px] text-[var(--text-muted)]">{sys.osVersion}</span>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-x-4 gap-y-1 border-t border-[var(--panel-border)] pt-2 text-[11px]">
        <span className="text-[var(--text-muted)]">
          时区 <span className="font-mono text-[var(--text-dark)]">{sys.tz ?? '-'}</span>
        </span>
        <span className="text-[var(--text-muted)]">
          运行时间{' '}
          <span className="font-medium text-[var(--accent)]">{fmtUptime(sys.uptimeSec)}</span>
        </span>
      </div>
    </Card>
  )
}

function CpuCard({
  stats,
  history
}: {
  stats: SystemStats
  history: number[]
}): React.ReactElement {
  const { cpu } = stats
  return (
    <Card
      icon={Cpu}
      title="CPU"
      badge={<Sparkline data={history} color="var(--accent)" width={110} height={26} />}
    >
      <div className="flex flex-col gap-1.5">
        {cpu.cores.length === 0 && (
          <div className="text-[11px] text-[var(--text-muted)]">
            总占用 {cpu.overall != null ? `${cpu.overall.toFixed(1)}%` : '-'}
          </div>
        )}
        {cpu.cores.map((v, i) => (
          <CoreBar key={i} index={i} value={v} />
        ))}
      </div>
    </Card>
  )
}

function MemLegend({
  dot,
  label,
  value
}: {
  dot: string
  label: string
  value: string
}): React.ReactElement {
  return (
    <div className="flex-1 rounded-lg bg-[var(--content-bg)] px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-xs font-semibold text-[var(--text-dark)]">{value}</div>
    </div>
  )
}

function MemCard({ mem }: { mem: MemStat }): React.ReactElement {
  return (
    <Card icon={MemoryStick} title="内存" badge={<Badge>{fmtMb(mem.totalMb)}</Badge>}>
      <div className="flex items-center gap-3">
        <Donut
          segments={[
            { value: mem.usedMb, color: 'var(--danger)' },
            { value: mem.cacheMb, color: 'var(--text-muted)' },
            { value: mem.freeMb, color: 'var(--accent)' }
          ]}
        />
        <div className="flex flex-1 gap-1.5">
          <MemLegend dot="var(--danger)" label="已用" value={fmtMb(mem.usedMb)} />
          <MemLegend dot="var(--text-muted)" label="缓存" value={fmtMb(mem.cacheMb)} />
          <MemLegend dot="var(--accent)" label="空闲" value={fmtMb(mem.freeMb)} />
        </div>
      </div>
    </Card>
  )
}

function NetCard({
  net,
  upHistory,
  downHistory
}: {
  net: NonNullable<SystemStats['net']>
  upHistory: number[]
  downHistory: number[]
}): React.ReactElement {
  return (
    <Card
      icon={Globe}
      title="网络"
      badge={
        <div className="flex items-center">
          <Sparkline data={upHistory} color="var(--accent)" width={64} height={24} />
          <Sparkline data={downHistory} color="var(--text-muted)" width={64} height={24} />
        </div>
      }
    >
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-1.5 text-[11px]">
        <span />
        <span className="text-[var(--text-muted)]">速度</span>
        <span className="text-[var(--text-muted)]">已用流量</span>

        <span className="flex items-center gap-1 text-[var(--text-dark)]">
          <ArrowUp size={12} className="text-[var(--accent)]" />
          上传
        </span>
        <span className="font-mono text-[var(--text-dark)]">{fmtRate(net.upBps)}</span>
        <span className="font-mono text-[var(--text-muted)]">{fmtBytes(net.upTotal)}</span>

        <span className="flex items-center gap-1 text-[var(--text-dark)]">
          <ArrowDown size={12} className="text-[var(--text-muted)]" />
          下载
        </span>
        <span className="font-mono text-[var(--text-dark)]">{fmtRate(net.downBps)}</span>
        <span className="font-mono text-[var(--text-muted)]">{fmtBytes(net.downTotal)}</span>
      </div>
    </Card>
  )
}

function DiskCard({ disk }: { disk: SystemStats['disk'] }): React.ReactElement {
  return (
    <Card
      icon={HardDrive}
      title="磁盘"
      badge={<Badge>{`${fmtBytes(disk.totalUsedB)} / ${fmtBytes(disk.totalSizeB)}`}</Badge>}
    >
      {(disk.readBps > 0 || disk.writeBps > 0 || disk.mounts.length > 0) && (
        <div className="mb-2 flex gap-2 text-[11px]">
          <div className="flex-1 rounded-lg bg-[var(--content-bg)] px-2 py-1.5">
            <div className="text-[10px] text-[var(--text-muted)]">读/s</div>
            <div className="font-mono text-xs text-[var(--text-dark)]">{fmtRate(disk.readBps)}</div>
          </div>
          <div className="flex-1 rounded-lg bg-[var(--content-bg)] px-2 py-1.5">
            <div className="text-[10px] text-[var(--text-muted)]">写/s</div>
            <div className="font-mono text-xs text-[var(--text-dark)]">
              {fmtRate(disk.writeBps)}
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="text-[var(--text-muted)]">挂载</span>
        <span className="text-right text-[var(--text-muted)]">大小</span>
        <span className="text-right text-[var(--text-muted)]">可用</span>
        <span className="text-right text-[var(--text-muted)]">已用%</span>
        {disk.mounts.map((m) => (
          <MountRow key={m.mount} m={m} />
        ))}
      </div>
    </Card>
  )
}

function MountRow({ m }: { m: SystemStats['disk']['mounts'][number] }): React.ReactElement {
  return (
    <>
      <span className="flex items-center gap-1 truncate font-mono text-[var(--text-dark)]">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: loadColor(m.percent) }}
        />
        {m.mount}
        <span className="ml-1 rounded bg-[var(--accent-soft)] px-1 text-[9px] text-[var(--accent)]">
          {m.fstype}
        </span>
      </span>
      <span className="text-right font-mono text-[var(--text-muted)]">{fmtBytes(m.sizeB)}</span>
      <span className="text-right font-mono text-[var(--text-muted)]">{fmtBytes(m.availB)}</span>
      <span className="text-right font-mono font-medium" style={{ color: loadColor(m.percent) }}>
        {m.percent}%
      </span>
    </>
  )
}

function ProcCard({
  procs,
  onViewAll
}: {
  procs: ProcInfo[]
  onViewAll: () => void
}): React.ReactElement {
  const hot = procs.filter((p) => p.cpu >= 0.5).slice(0, 5)
  return (
    <Card
      icon={ListTree}
      title="进程管理"
      badge={
        <button
          onClick={onViewAll}
          className="rounded-md px-2 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
        >
          查看全部
        </button>
      }
    >
      <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <span className="text-[var(--text-muted)]">CPU</span>
        <span className="text-[var(--text-muted)]">MEM</span>
        <span className="text-[var(--text-muted)]">CMD</span>
        {hot.length === 0 && (
          <span className="col-span-3 py-1 text-center text-[var(--text-muted)]">暂无热点进程</span>
        )}
        {hot.map((p) => (
          <ProcMiniRow key={p.pid} p={p} />
        ))}
      </div>
    </Card>
  )
}

function ProcMiniRow({ p }: { p: ProcInfo }): React.ReactElement {
  return (
    <>
      <span className="font-mono text-[var(--accent)]">{p.cpu.toFixed(1)}</span>
      <span className="font-mono text-[var(--text-muted)]">{p.mem.toFixed(1)}</span>
      <span className="truncate font-mono text-[var(--text-dark)]" title={p.cmd}>
        {p.cmd}
      </span>
    </>
  )
}

// ---- 进程管理弹窗 ------------------------------------------------------------
function ProcessModal({
  sessionId,
  onClose
}: {
  sessionId: string
  onClose: () => void
}): React.ReactElement {
  const [procs, setProcs] = useState<ProcInfo[]>([])
  const [query, setQuery] = useState('')
  const [auto, setAuto] = useState(false)

  // 手动刷新 / 结束进程后调用(事件处理器里 setState 是允许的)。
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const out = await window.api.ssh.exec(sessionId, PROC_COMMAND)
      setProcs(parseProcList(out))
    } catch {
      /* 忽略单次失败,下一轮再试 */
    }
  }, [sessionId])

  // 初次加载 + 自动刷新;轮询逻辑内联在 effect 中(setState 均在 await 之后)。
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const out = await window.api.ssh.exec(sessionId, PROC_COMMAND)
        if (!cancelled) setProcs(parseProcList(out))
      } catch {
        /* 忽略单次失败 */
      }
    }
    void run()
    if (!auto) return () => void (cancelled = true)
    const t = setInterval(() => void run(), 2000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [sessionId, auto])

  const kill = async (pid: number, force: boolean): Promise<void> => {
    try {
      await window.api.ssh.exec(sessionId, `kill -${force ? 'KILL' : 'TERM'} ${pid} 2>&1`)
    } finally {
      void refresh()
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? procs.filter(
        (p) =>
          String(p.pid).includes(q) ||
          p.user.toLowerCase().includes(q) ||
          p.cmd.toLowerCase().includes(q)
      )
    : procs

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-[min(1100px,92vw)] flex-col rounded-[var(--radius-lg)] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏:搜索 + 自动刷新 + 刷新 + 关闭 */}
        <div className="flex items-center gap-2 border-b border-[var(--panel-border)] p-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg bg-[var(--content-bg)] px-2.5 py-1.5">
            <Search size={14} className="text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 PID / 用户 / 命令"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            自动刷新
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          </label>
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--panel-border)] px-3 py-1.5 text-xs text-[var(--text-dark)] hover:border-[var(--accent)]"
          >
            <RefreshCw size={13} />
            刷新
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* 进程表 */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-[var(--panel-bg)]">
              <tr className="border-b border-[var(--panel-border)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-2 font-medium">PID</th>
                <th className="px-3 py-2 font-medium">USER</th>
                <th className="px-3 py-2 font-medium">STAT</th>
                <th className="px-3 py-2 text-right font-medium">CPU</th>
                <th className="px-3 py-2 text-right font-medium">MEM</th>
                <th className="px-3 py-2 font-medium">START</th>
                <th className="px-3 py-2 font-medium">CMD</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.pid}
                  className="border-b border-[var(--panel-border)] hover:bg-[var(--nav-bg-hover)]"
                >
                  <td className="px-3 py-1.5 font-mono text-[var(--text-dark)]">{p.pid}</td>
                  <td className="px-3 py-1.5 text-[var(--text-muted)]">{p.user}</td>
                  <td className="px-3 py-1.5">
                    <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent)]">
                      {p.stat}
                    </span>
                  </td>
                  <td
                    className="px-3 py-1.5 text-right font-mono"
                    style={{ color: loadColor(p.cpu) }}
                  >
                    {p.cpu.toFixed(1)}%
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[var(--text-muted)]">
                    {p.mem.toFixed(1)}%
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[var(--text-muted)]">
                    {fmtStart(p.startEpoch)}
                  </td>
                  <td
                    className="max-w-[280px] truncate px-3 py-1.5 font-mono text-[var(--text-dark)]"
                    title={p.cmd}
                  >
                    {p.cmd}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button
                      onClick={() => void kill(p.pid, false)}
                      className="mr-2 text-[var(--text-muted)] hover:text-[var(--accent)]"
                    >
                      结束
                    </button>
                    <button
                      onClick={() => void kill(p.pid, true)}
                      className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                    >
                      强制结束
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-[var(--text-muted)]">
                    {procs.length === 0 ? '正在读取进程...' : '没有匹配的进程'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---- 主面板 ------------------------------------------------------------------
export function MonitorPanel({
  sessionId,
  connected
}: {
  sessionId: string
  connected: boolean
}): React.ReactElement {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [cpuHist, setCpuHist] = useState<number[]>([])
  const [upHist, setUpHist] = useState<number[]>([])
  const [downHist, setDownHist] = useState<number[]>([])

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    const push = (v: number) => (prev: number[]) => [...prev, v].slice(-HISTORY_LEN)
    const poll = async (): Promise<void> => {
      try {
        const out = await window.api.ssh.exec(sessionId, MONITOR_COMMAND)
        if (cancelled) return
        const s = parseMonitorOutput(out)
        setCpuHist(push(s.cpu.overall ?? 0))
        if (s.net) {
          setUpHist(push(s.net.upBps))
          setDownHist(push(s.net.downBps))
        }
        setStats(s)
        setError('')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void poll()
    const t = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [sessionId, connected])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-4">
        <span className="text-sm font-semibold text-[var(--text-dark)]">系统监控</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!connected && <div className="text-xs text-[var(--text-muted)]">未连接</div>}
        {connected && !stats && !error && (
          <div className="text-xs text-[var(--text-muted)]">正在读取...</div>
        )}
        {error && <div className="text-xs text-[var(--danger)]">读取失败: {error}</div>}
        {stats && (
          <div className="flex flex-col gap-3">
            <SystemCard stats={stats} />
            <CpuCard stats={stats} history={cpuHist} />
            {stats.mem && <MemCard mem={stats.mem} />}
            {stats.net && <NetCard net={stats.net} upHistory={upHist} downHistory={downHist} />}
            <DiskCard disk={stats.disk} />
            <ProcCard procs={stats.procs} onViewAll={() => setModalOpen(true)} />
          </div>
        )}
      </div>
      {modalOpen && <ProcessModal sessionId={sessionId} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
