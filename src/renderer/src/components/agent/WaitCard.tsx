import { memo, useMemo } from 'react'
import { AlertCircle, Check, Clock, Hourglass, Loader2 } from 'lucide-react'
import type { ToolCall } from '@shared/types'
import { formatDuration } from '../../lib/agentWait'

interface WaitCallArgs {
  reason?: string
  target?: string
  check_command?: string
  interval_seconds?: number
  max_wait_seconds?: number
  done_when?: { exit_code?: number; output_matches?: string }
  fail_when?: { output_matches?: string }
}

function parse(tc: ToolCall): WaitCallArgs {
  try {
    return JSON.parse(tc.function.arguments || '{}') as WaitCallArgs
  } catch {
    return {}
  }
}

/** 结果头「[等待结束: xxx]」→ 卡片状态。 */
function outcomeOf(result: string): { tone: 'ok' | 'fail' | 'warn' | 'note'; label: string } {
  const m = /^\[等待结束: ([^\]]+)\]/.exec(result)
  if (!m)
    return { tone: 'note', label: result.startsWith('未开始等待') ? '未开始等待' : '等待结束' }
  const label = m[1]
  if (label === '条件满足' || label === '等待时间到') return { tone: 'ok', label }
  if (label === '检测到失败特征' || label === '检查命令连续执行失败') return { tone: 'fail', label }
  return { tone: 'warn', label }
}

/** 对话里 wait_and_check 调用的卡片:等待中显示参数,结束后显示结论与最后一次检查的输出。 */
export const WaitCard = memo(function WaitCard({
  tc,
  result,
  active
}: {
  tc: ToolCall
  result?: string
  /** 该调用正是当前进行中的等待。 */
  active: boolean
}): React.ReactElement {
  const a = useMemo(() => parse(tc), [tc])
  const outcome = result !== undefined ? outcomeOf(result) : null
  const conds = [
    a.done_when?.exit_code !== undefined ? `退出码 = ${a.done_when.exit_code}` : '',
    a.done_when?.output_matches ? `输出匹配 /${a.done_when.output_matches}/` : ''
  ].filter(Boolean)
  const body = result?.split('\n').slice(1).join('\n').trim()

  return (
    <div className="self-start w-[92%] overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <Hourglass size={13} className="text-[var(--accent)]" />
        <span className="min-w-0 truncate text-xs font-medium text-[var(--text-muted)]">
          等待 · {a.reason || '后台任务'}
        </span>
        {a.target && (
          <span className="ml-auto shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
            {a.target}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 px-2.5 py-2 text-xs">
        {a.check_command ? (
          <pre className="selectable overflow-x-auto font-mono text-xs text-[var(--text-dark)]">
            {a.check_command}
          </pre>
        ) : (
          <div className="text-[var(--text-dark)]">单纯等待,时间到后继续</div>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <Clock size={10} />每 {formatDuration((a.interval_seconds ?? 60) * 1000)} 检查一次
          </span>
          {a.check_command && (
            <span>最长 {formatDuration((a.max_wait_seconds ?? 3600) * 1000)}</span>
          )}
          {conds.length > 0 && <span>完成: {conds.join(' 或 ')}</span>}
          {a.fail_when?.output_matches && <span>失败: /{a.fail_when.output_matches}/</span>}
        </div>
      </div>
      {outcome ? (
        <div className="border-t border-[var(--panel-border)]">
          <div
            className={`flex items-center gap-1.5 px-2.5 pt-1.5 text-xs ${
              outcome.tone === 'fail'
                ? 'text-[var(--danger)]'
                : outcome.tone === 'warn'
                  ? 'text-amber-600'
                  : 'text-[var(--text-muted)]'
            }`}
          >
            {outcome.tone === 'ok' ? (
              <Check size={12} className="text-green-600" />
            ) : (
              <AlertCircle size={12} />
            )}
            {outcome.label}
          </div>
          <pre className="selectable max-h-48 overflow-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-xs text-[var(--text-dark)]">
            {outcome.tone === 'note' ? result : body || result}
          </pre>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 border-t border-[var(--panel-border)] px-2.5 py-1.5 text-xs text-[var(--text-muted)]">
          <Loader2 size={12} className={active ? 'animate-spin' : ''} />
          {active ? '等待中,倒计时见输入框上方' : '等待未完成'}
        </div>
      )}
    </div>
  )
})
