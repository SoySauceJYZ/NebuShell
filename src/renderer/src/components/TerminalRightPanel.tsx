import { useEffect, useRef, useState } from 'react'
import {
  History,
  Activity,
  Palette,
  FolderOpen,
  Search,
  Trash2,
  Check,
  Zap,
  Languages,
  Minus,
  Plus,
  Bot
} from 'lucide-react'
import {
  useTerminalStore,
  type RightPanelTab,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE
} from '../store/useTerminalStore'
import { TERMINAL_THEMES, DEFAULT_THEME_ID } from '../lib/terminalThemes'
import { MONITOR_COMMAND, parseMonitorOutput, type SystemStats } from '../lib/systemMonitor'
import { SftpPanel } from './SftpPanel'
import { AgentPanel } from './AgentPanel'

// Stable empty reference so the zustand selector doesn't return a fresh array each
// render (which would trigger an infinite re-render loop and blank the app).
const EMPTY_HISTORY: string[] = []

const TABS: { id: Exclude<RightPanelTab, null>; label: string; icon: typeof History }[] = [
  { id: 'agent', label: '智能体', icon: Bot },
  { id: 'actions', label: '快捷操作', icon: Zap },
  { id: 'history', label: '历史命令', icon: History },
  { id: 'monitor', label: '监控', icon: Activity },
  { id: 'theme', label: '主题', icon: Palette },
  { id: 'sftp', label: 'SFTP', icon: FolderOpen }
]

export function TerminalRightPanel({
  sessionId,
  hostId,
  connected
}: {
  sessionId: string
  hostId: string
  connected: boolean
}): React.ReactElement {
  const rightPanelTab = useTerminalStore((s) => s.rightPanelTab)
  const toggleRightPanel = useTerminalStore((s) => s.toggleRightPanel)
  const panelWidth = useTerminalStore((s) => s.rightPanelWidth)
  const setPanelWidth = useTerminalStore((s) => s.setRightPanelWidth)

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useTerminalStore.getState().rightPanelWidth
    const onMove = (ev: MouseEvent): void => {
      // panel is on the right; dragging its left edge leftwards widens it.
      setPanelWidth(startW + (startX - ev.clientX))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
  }

  return (
    <div className="flex h-full shrink-0">
      {rightPanelTab && (
        <div
          className="relative flex h-full flex-col border-l border-[var(--panel-border)] bg-[var(--panel-bg)]"
          style={{ width: panelWidth }}
        >
          <div
            onMouseDown={startResize}
            title="拖动调整宽度"
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-[var(--accent)]/20"
          />
          {rightPanelTab === 'agent' && (
            <AgentPanel sessionId={sessionId} hostId={hostId} connected={connected} />
          )}
          {rightPanelTab === 'actions' && (
            <ActionsSection sessionId={sessionId} connected={connected} />
          )}
          {rightPanelTab === 'history' && <HistorySection sessionId={sessionId} />}
          {rightPanelTab === 'monitor' && (
            <MonitorSection sessionId={sessionId} connected={connected} />
          )}
          {rightPanelTab === 'theme' && <ThemeSection sessionId={sessionId} />}
          {rightPanelTab === 'sftp' && (
            <div className="min-h-0 flex-1">
              <SftpPanel sessionId={`${sessionId}::sftp`} hostId={hostId} />
            </div>
          )}
        </div>
      )}

      <div className="flex w-11 flex-col items-center gap-1 border-l border-[var(--panel-border)] bg-[var(--nav-bg)] py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = rightPanelTab === tab.id
          return (
            <button
              key={tab.id}
              title={tab.label}
              onClick={() => toggleRightPanel(tab.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                active
                  ? 'bg-[var(--nav-active-bg)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]'
              }`}
            >
              <Icon size={18} strokeWidth={1.75} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  action
}: {
  title: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-4">
      <span className="text-sm font-semibold text-[var(--text-dark)]">{title}</span>
      {action}
    </div>
  )
}

// Makes readline 8-bit clean and sets a UTF-8 locale so the shell accepts/echoes
// multibyte (Chinese) input even when the SSH session's LANG is unset or C/POSIX.
const ENABLE_CJK_COMMAND =
  "export LANG=C.UTF-8 2>/dev/null; export LC_ALL=C.UTF-8 2>/dev/null; " +
  "bind 'set input-meta on' 2>/dev/null; bind 'set output-meta on' 2>/dev/null; " +
  "bind 'set convert-meta off' 2>/dev/null; clear"

function ActionsSection({
  sessionId,
  connected
}: {
  sessionId: string
  connected: boolean
}): React.ReactElement {
  const [done, setDone] = useState(false)

  const enableCjk = (): void => {
    window.api.ssh.write(sessionId, ENABLE_CJK_COMMAND + '\n')
    setDone(true)
    window.setTimeout(() => setDone(false), 2500)
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="快捷操作" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <button
          onClick={enableCjk}
          disabled={!connected}
          className="flex w-full items-start gap-3 rounded-lg border border-[var(--panel-border)] p-3 text-left transition hover:border-[var(--accent)] disabled:opacity-50"
        >
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <Languages size={18} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-dark)]">
              启用中文输入
              {done && (
                <span className="flex items-center gap-1 text-xs font-normal text-[var(--accent)]">
                  <Check size={13} />
                  已启用
                </span>
              )}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
              让当前终端支持中文的输入与显示(设置 UTF-8 locale 并使 readline 8-bit 干净)。
            </div>
          </div>
        </button>
        <p className="mt-3 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
          仅对当前会话生效。如需永久生效,可将相同设置写入服务器的 ~/.bashrc。
        </p>
      </div>
    </div>
  )
}

function HistorySection({ sessionId }: { sessionId: string }): React.ReactElement {
  const history = useTerminalStore((s) => s.history[sessionId] ?? EMPTY_HISTORY)
  const clearHistory = useTerminalStore((s) => s.clearHistory)
  const [query, setQuery] = useState('')

  const filtered = [...history].reverse().filter((c) => c.toLowerCase().includes(query.toLowerCase()))

  const run = (cmd: string): void => {
    window.api.ssh.write(sessionId, cmd + '\n')
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        title="历史命令"
        action={
          history.length > 0 ? (
            <button
              onClick={() => clearHistory(sessionId)}
              title="清空"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
            >
              <Trash2 size={14} />
            </button>
          ) : null
        }
      />
      <div className="border-b border-[var(--panel-border)] p-2">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--content-bg)] px-2.5 py-1.5">
          <Search size={14} className="text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索命令"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="mt-10 text-center text-xs text-[var(--text-muted)]">
            {history.length === 0 ? '暂无输入的命令' : '没有匹配的命令'}
          </div>
        )}
        {filtered.map((cmd, i) => (
          <button
            key={`${cmd}-${i}`}
            onClick={() => run(cmd)}
            title="点击重新执行"
            className="block w-full truncate px-4 py-2 text-left font-mono text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
          >
            {cmd}
          </button>
        ))}
      </div>
    </div>
  )
}

function MonitorSection({
  sessionId,
  connected
}: {
  sessionId: string
  connected: boolean
}): React.ReactElement {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [error, setError] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!connected) return
    let cancelled = false

    const poll = async (): Promise<void> => {
      try {
        const out = await window.api.ssh.exec(sessionId, MONITOR_COMMAND)
        if (!cancelled) {
          setStats(parseMonitorOutput(out))
          setError('')
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    poll()
    timerRef.current = setInterval(poll, 3000)
    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [sessionId, connected])

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="系统监控" />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!connected && <div className="text-xs text-[var(--text-muted)]">未连接</div>}
        {connected && !stats && !error && (
          <div className="text-xs text-[var(--text-muted)]">正在读取...</div>
        )}
        {error && <div className="text-xs text-[var(--danger)]">读取失败: {error}</div>}
        {stats && (
          <div className="flex flex-col gap-4">
            <StatBar label="CPU" percent={stats.cpuPercent} detail={pct(stats.cpuPercent)} />
            <StatBar
              label="内存"
              percent={stats.memPercent}
              detail={
                stats.memUsedMb != null && stats.memTotalMb != null
                  ? `${fmtMb(stats.memUsedMb)} / ${fmtMb(stats.memTotalMb)}`
                  : pct(stats.memPercent)
              }
            />
            <StatBar
              label="磁盘 /"
              percent={stats.diskPercent}
              detail={
                stats.diskUsed && stats.diskTotal
                  ? `${stats.diskUsed} / ${stats.diskTotal}`
                  : pct(stats.diskPercent)
              }
            />
            <InfoRow label="负载" value={stats.load ?? '-'} />
            <InfoRow label="运行时间" value={stats.uptime ?? '-'} />
          </div>
        )}
      </div>
    </div>
  )
}

function pct(v: number | null): string {
  return v == null ? '-' : `${v}%`
}
function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${mb}M`
}

function StatBar({
  label,
  percent,
  detail
}: {
  label: string
  percent: number | null
  detail: string
}): React.ReactElement {
  const value = percent ?? 0
  const color = value >= 85 ? '#c0392b' : value >= 60 ? '#d68a3d' : 'var(--accent)'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-dark)]">{label}</span>
        <span className="text-[var(--text-muted)]">{detail}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--content-bg)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, value)}%`, background: color }}
        />
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="font-medium text-[var(--text-dark)]">{label}</span>
      <span className="font-mono text-[var(--text-muted)]">{value}</span>
    </div>
  )
}

function ThemeSection({ sessionId }: { sessionId: string }): React.ReactElement {
  const currentId = useTerminalStore((s) => s.themeBySession[sessionId])
  const setTheme = useTerminalStore((s) => s.setTheme)
  const fontSize = useTerminalStore((s) => s.fontSizeBySession[sessionId] ?? DEFAULT_FONT_SIZE)
  const setFontSize = useTerminalStore((s) => s.setFontSize)
  const activeId = currentId ?? DEFAULT_THEME_ID

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="终端主题" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          {TERMINAL_THEMES.map((preset) => {
            const active = preset.id === activeId
            return (
              <button
                key={preset.id}
                onClick={() => setTheme(sessionId, preset.id)}
                className={`flex items-center gap-3 rounded-lg border p-2.5 text-left transition ${
                  active
                    ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                    : 'border-[var(--panel-border)] hover:border-[var(--accent)]'
                }`}
              >
                <div
                  className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md font-mono text-[11px]"
                  style={{
                    background: preset.theme.background,
                    color: preset.theme.foreground
                  }}
                >
                  $_
                </div>
                <span className="flex-1 text-sm font-medium text-[var(--text-dark)]">
                  {preset.name}
                </span>
                {active && <Check size={16} className="text-[var(--accent)]" />}
              </button>
            )
          })}
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            字号(仅终端)
          </div>
          <div className="flex items-center gap-2">
            <StepperButton
              onClick={() => setFontSize(sessionId, fontSize - 1)}
              disabled={fontSize <= MIN_FONT_SIZE}
            >
              <Minus size={15} />
            </StepperButton>
            <div className="min-w-[3.5rem] rounded-lg border border-[var(--panel-border)] py-1.5 text-center text-sm font-medium text-[var(--text-dark)]">
              {fontSize} px
            </div>
            <StepperButton
              onClick={() => setFontSize(sessionId, fontSize + 1)}
              disabled={fontSize >= MAX_FONT_SIZE}
            >
              <Plus size={15} />
            </StepperButton>
            {fontSize !== DEFAULT_FONT_SIZE && (
              <button
                onClick={() => setFontSize(sessionId, DEFAULT_FONT_SIZE)}
                className="ml-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
              >
                重置
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepperButton({
  onClick,
  disabled,
  children
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--panel-border)] text-[var(--text-dark)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
