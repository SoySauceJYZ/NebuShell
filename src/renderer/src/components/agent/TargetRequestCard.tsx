import { memo, useMemo, useState } from 'react'
import { Check, Link2, Loader2, PlugZap, Server, TerminalSquare, X } from 'lucide-react'
import type { ToolCall } from '@shared/types'
import { useAgentStore, type TargetRequestMeta } from '../../store/useAgentStore'
import { useSessionStore } from '../../store/useSessionStore'
import { useVaultStore } from '../../store/useVaultStore'
import {
  allTargetCandidates,
  candidateKey,
  candidateLabel,
  type TargetCandidate
} from '../../lib/targetRequest'

const NO_TARGETS: never[] = []

function CandidateRow({
  c,
  busy,
  disabled,
  onPick
}: {
  c: TargetCandidate
  busy: boolean
  disabled: boolean
  onPick: () => void
}): React.ReactElement {
  const isTab = c.kind === 'tab'
  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--nav-bg-hover)]">
      {isTab ? (
        <TerminalSquare size={13} className="shrink-0 text-[var(--accent)]" />
      ) : (
        <Server size={13} className="shrink-0 text-[var(--accent)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-[var(--text-dark)]">
          {candidateLabel(c)}
        </div>
        <div className="truncate text-[10px] text-[var(--text-muted)]">
          {isTab ? `已打开的终端 · ${c.address || c.hostLabel}` : `主机库 · ${c.address}`}
        </div>
      </div>
      <button
        onClick={onPick}
        disabled={disabled}
        className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : isTab ? (
          <Link2 size={11} />
        ) : (
          <PlugZap size={11} />
        )}
        {busy ? (isTab ? '附加中…' : '连接中…') : isTab ? '加入目标' : '连接并加入'}
      </button>
    </div>
  )
}

/**
 * request_target 的确认卡片:智能体需要一台不在目标里的服务器时,列出匹配的已打开终端 / 主机库主机,
 * 用户点一下即(后台新开并连接后)勾进目标;都不对时可从全部主机里另选,或拒绝。
 */
export const TargetRequestCard = memo(function TargetRequestCard({
  sessionId,
  tc,
  meta,
  result,
  running,
  disabled
}: {
  sessionId: string
  tc: ToolCall
  meta?: TargetRequestMeta
  result?: string
  running: boolean
  disabled: boolean
}): React.ReactElement {
  const resolve = useAgentStore((s) => s.resolveTargetRequest)
  const targets = useAgentStore((s) => s.targetsBySession[sessionId] ?? NO_TARGETS)
  const tabs = useSessionStore((s) => s.tabs)
  const hosts = useVaultStore((s) => s.hosts)
  const [other, setOther] = useState('')
  const args = useMemo(() => {
    try {
      return JSON.parse(tc.function.arguments || '{}') as { query?: string; reason?: string }
    } catch {
      return {}
    }
  }, [tc])
  const query = meta?.query ?? args.query ?? ''
  const reason = meta?.reason ?? args.reason ?? ''
  const pending = result === undefined
  const candidates = meta?.candidates ?? NO_TARGETS
  // 「从其他主机选择」只在卡片待处理时才需要,避免已完成的卡片每次都扫一遍 tab / 主机。
  const others = useMemo(
    () =>
      pending
        ? allTargetCandidates({ tabs, hosts, targets }).filter(
            (c) => !candidates.some((x) => candidateKey(x) === candidateKey(c))
          )
        : [],
    [pending, tabs, hosts, targets, candidates]
  )
  const pickOther = others.find((c) => candidateKey(c) === other)
  const failed = result !== undefined && /失败|拒绝/.test(result)
  const busyKey = meta?.connecting
  const locked = disabled || running || Boolean(busyKey)

  return (
    <div className="self-start w-[92%] overflow-hidden rounded-xl border border-[var(--accent)]/50 bg-[var(--panel-bg)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <PlugZap size={13} className="text-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--text-muted)]">
          {pending ? '需要补充目标服务器' : '补充目标'}
        </span>
        {query && (
          <span className="ml-auto truncate rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--accent)]">
            {query}
          </span>
        )}
      </div>
      {reason && <div className="px-2.5 pt-2 text-xs text-[var(--text-dark)]">{reason}</div>}

      {pending ? (
        <div className="flex flex-col gap-1.5 px-2.5 py-2">
          {candidates.length > 0 ? (
            <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
              {candidates.map((c) => (
                <CandidateRow
                  key={candidateKey(c)}
                  c={c}
                  busy={busyKey === candidateKey(c)}
                  disabled={locked}
                  onPick={() => resolve(sessionId, tc, c)}
                />
              ))}
            </div>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">
              主机库和已打开的终端里没有找到「{query}」。可以从下面另选一台,或先到「主机」页添加。
            </div>
          )}
          {others.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                value={other}
                onChange={(e) => setOther(e.target.value)}
                disabled={locked}
                className="input min-w-0 flex-1 !py-1 text-xs"
              >
                <option value="">
                  {candidates.length ? '都不对?从其他主机选择…' : '从主机中选择…'}
                </option>
                {others.map((c) => (
                  <option key={candidateKey(c)} value={candidateKey(c)}>
                    {c.kind === 'tab'
                      ? `[已打开] ${c.title} · ${c.address || c.hostLabel}`
                      : `${c.label} · ${c.address}`}
                  </option>
                ))}
              </select>
              <button
                disabled={locked || !pickOther}
                onClick={() => pickOther && resolve(sessionId, tc, pickOther)}
                className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {busyKey && pickOther && busyKey === candidateKey(pickOther) ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <PlugZap size={11} />
                )}
                加入
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              disabled={locked}
              onClick={() => resolve(sessionId, tc, null)}
              className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs hover:bg-[var(--nav-bg-hover)] disabled:opacity-50"
            >
              <X size={11} />
              拒绝
            </button>
            {busyKey && (
              <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <Loader2 size={11} className="animate-spin" />
                正在后台打开并连接终端…
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 border-t border-[var(--panel-border)] px-2.5 py-2 text-xs">
          <div className="flex items-start gap-1.5 text-[var(--text-dark)]">
            {failed ? (
              <X size={12} className="mt-0.5 shrink-0 text-[var(--danger)]" />
            ) : (
              <Check size={12} className="mt-0.5 shrink-0 text-green-600" />
            )}
            <span className="selectable">{result}</span>
          </div>
        </div>
      )}
    </div>
  )
})
