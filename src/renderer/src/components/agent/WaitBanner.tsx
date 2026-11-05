import { memo, useEffect, useState } from 'react'
import { ChevronDown, FastForward, Hourglass, Loader2, RefreshCw, X } from 'lucide-react'
import { useAgentStore } from '../../store/useAgentStore'
import { formatDuration, tailLines, type WaitState } from '../../lib/agentWait'

/** 每秒走一次的「现在」,倒计时用。只在有等待时挂载(BannerBody),不等待时不耗计时器。 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** 倒计时圆环:剩余比例从满到空。 */
function Ring({ ratio, spinning }: { ratio: number; spinning: boolean }): React.ReactElement {
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
      <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--panel-border)" strokeWidth="2.5" />
        {!spinning && (
          <circle
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(0, Math.min(1, ratio)))}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        )}
      </svg>
      {spinning ? (
        <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
      ) : (
        <Hourglass size={11} className="text-[var(--accent)]" />
      )}
    </div>
  )
}

function lastLine(text: string): string {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim())
  return lines[lines.length - 1] ?? ''
}

function BannerBody({
  sessionId,
  wait
}: {
  sessionId: string
  wait: WaitState
}): React.ReactElement {
  const checkNow = useAgentStore((s) => s.checkNow)
  const endWait = useAgentStore((s) => s.endWait)
  const cancelWait = useAgentStore((s) => s.cancelWait)
  const now = useNow()
  const [open, setOpen] = useState(false)
  const checking = wait.phase === 'checking'
  const remaining = Math.max(0, wait.nextAt - now)
  const ratio = remaining / (wait.intervalSec * 1000)
  const elapsed = now - wait.startedAt
  const maxTotal = wait.deadline - wait.startedAt
  const latest = lastLine(wait.lastOutput)

  return (
    <div className="mb-1.5 overflow-hidden rounded-xl border border-[var(--accent)]/35 bg-[var(--accent-soft)]/45 shadow-sm">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Ring ratio={ratio} spinning={checking} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="shrink-0 font-medium text-[var(--accent)]">
              {checking ? '正在检查进度' : wait.command ? '等待继续检查' : '等待继续执行'}
            </span>
            {!checking && (
              <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-[var(--text-dark)]">
                {formatDuration(remaining)}
              </span>
            )}
            <span className="min-w-0 truncate text-[var(--text-dark)]">{wait.reason}</span>
          </div>
          <div className="truncate text-[10px] text-[var(--text-muted)]">
            {wait.targetName}
            {wait.command ? ` · 已检查 ${wait.ticks} 次` : ''} · 已等待 {formatDuration(elapsed)} /
            最长 {formatDuration(maxTotal)}
            {wait.errors > 0 ? ` · 检查失败 ${wait.errors} 次` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {wait.command && (
            <button
              onClick={() => checkNow(sessionId)}
              disabled={checking}
              title="立即检查一次"
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--panel-bg)] disabled:opacity-40"
            >
              <RefreshCw size={12} />
              立即检查
            </button>
          )}
          <button
            onClick={() => endWait(sessionId)}
            title="结束等待,把当前进度交给智能体继续"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--panel-bg)]"
          >
            <FastForward size={12} />
            继续
          </button>
          <button
            onClick={() => cancelWait(sessionId)}
            title="取消等待并停止本轮任务"
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--panel-bg)] hover:text-[var(--danger)]"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      {wait.command && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 border-t border-[var(--accent)]/20 px-2.5 py-1 text-left text-[11px] text-[var(--text-muted)] hover:bg-[var(--panel-bg)]/50"
        >
          <span className="shrink-0 font-mono text-[var(--accent)]">$</span>
          <span className="min-w-0 flex-1 truncate font-mono">
            {open
              ? wait.command
              : latest || (wait.ticks === 0 ? `首次检查将在倒计时结束后执行` : '(无输出)')}
          </span>
          <ChevronDown size={12} className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && wait.command && (
        <pre className="selectable max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-[var(--accent)]/20 bg-[var(--panel-bg)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-dark)]">
          {wait.ticks > 0 || wait.errors > 0
            ? `${wait.lastExitCode !== null ? `[退出码 ${wait.lastExitCode}]\n` : ''}${tailLines(wait.lastOutput, 20) || '(无输出)'}`
            : '尚未检查'}
        </pre>
      )}
    </div>
  )
}

/** 输入框上方的「等待继续执行」倒计时条;没有等待时不渲染。 */
export const WaitBanner = memo(function WaitBanner({
  sessionId
}: {
  sessionId: string
}): React.ReactElement | null {
  const wait = useAgentStore((s) => s.sessions[sessionId]?.wait)
  if (!wait) return null
  return <BannerBody sessionId={sessionId} wait={wait} />
})
