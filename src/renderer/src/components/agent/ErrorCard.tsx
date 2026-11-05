import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Gauge,
  KeyRound,
  RotateCcw,
  Server,
  Settings,
  SquarePen,
  WifiOff
} from 'lucide-react'
import type { LlmErrorInfo } from '@shared/types'
import { classifyLlmError, type LlmErrorKind } from '../../lib/agentErrors'

const KIND_ICON: Record<LlmErrorKind, typeof AlertTriangle> = {
  auth: KeyRound,
  rate: Gauge,
  context: Gauge,
  model: Server,
  server: Server,
  network: WifiOff,
  config: Settings,
  unknown: AlertTriangle
}

/**
 * LLM 请求失败的展示卡片:标题 + 原因 + 处理建议,原始响应收在「详细信息」里,
 * 并按错误类型给出补救按钮(重试 / 管理模型 / 新会话)。
 */
export function ErrorCard({
  error,
  canRetry,
  onRetry,
  onManageProviders,
  onNewConversation
}: {
  error: LlmErrorInfo
  canRetry: boolean
  onRetry: () => void
  onManageProviders: () => void
  onNewConversation: () => void
}): React.ReactElement {
  const view = useMemo(() => classifyLlmError(error), [error])
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const Icon = KIND_ICON[view.kind]
  const showSettings = ['auth', 'model', 'config', 'rate'].includes(view.kind)

  const copy = (): void => {
    window.api.clipboard.writeText(view.detail)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="self-start w-[92%] overflow-hidden rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/[0.06]">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--danger)]/15">
          <Icon size={13} className="text-[var(--danger)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--danger)]">{view.title}</div>
          {view.reason && view.reason !== view.title && (
            <div className="selectable mt-0.5 break-words text-xs text-[var(--text-dark)]">
              {view.reason}
            </div>
          )}
          <div className="mt-1 text-xs text-[var(--text-muted)]">{view.hint}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
        {(view.retryable || view.kind === 'unknown') && (
          <button
            onClick={onRetry}
            disabled={!canRetry}
            className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <RotateCcw size={11} />
            重试
          </button>
        )}
        {showSettings && (
          <button
            onClick={onManageProviders}
            className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1 text-xs hover:bg-[var(--nav-bg-hover)]"
          >
            <Settings size={11} />
            管理模型
          </button>
        )}
        {view.kind === 'context' && (
          <button
            onClick={onNewConversation}
            disabled={!canRetry}
            className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1 text-xs hover:bg-[var(--nav-bg-hover)] disabled:opacity-50"
          >
            <SquarePen size={11} />
            新会话
          </button>
        )}
        {!view.retryable && view.kind !== 'unknown' && (
          <button
            onClick={onRetry}
            disabled={!canRetry}
            className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1 text-xs hover:bg-[var(--nav-bg-hover)] disabled:opacity-50"
          >
            <RotateCcw size={11} />
            重试
          </button>
        )}
        {view.detail && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            详细信息
            <ChevronDown size={12} className={`transition ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {open && view.detail && (
        <div className="relative border-t border-[var(--danger)]/20 bg-[var(--panel-bg)]">
          <button
            onClick={copy}
            title="复制"
            className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
          </button>
          <pre className="selectable max-h-48 overflow-auto whitespace-pre-wrap break-all px-3 py-2 pr-8 font-mono text-[11px] text-[var(--text-dark)]">
            {view.detail}
          </pre>
        </div>
      )}
    </div>
  )
}
