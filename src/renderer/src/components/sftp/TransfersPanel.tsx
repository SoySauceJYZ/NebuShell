import { X, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useTransfersStore, isActivePhase, type TransferItem } from '../../store/useTransfersStore'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

/** Remaining time as e.g. "3秒" / "1分20秒" / "1时05分". */
function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return ''
  const s = Math.round(seconds)
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分${String(s % 60).padStart(2, '0')}秒`
  const h = Math.floor(m / 60)
  return `${h}时${String(m % 60).padStart(2, '0')}分`
}

function pct(t: TransferItem): number {
  if (t.totalBytes > 0) return Math.min(100, Math.round((t.doneBytes / t.totalBytes) * 100))
  return t.phase === 'done' ? 100 : 0
}

function TransferRow({ t }: { t: TransferItem }): React.ReactElement {
  const remove = useTransfersStore((s) => s.remove)
  const active = isActivePhase(t.phase)
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        {t.phase === 'error' ? (
          <AlertCircle size={14} className="shrink-0 text-[var(--danger)]" />
        ) : t.phase === 'done' ? (
          <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
        ) : (
          <Loader2 size={14} className="shrink-0 animate-spin text-[var(--accent)]" />
        )}
        <span className="flex-1 truncate text-xs font-medium text-[var(--text-dark)]">
          {t.label}
        </span>
        <button
          onClick={() => remove(t.id)}
          title="移除记录"
          className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
        >
          <X size={12} />
        </button>
      </div>

      {t.phase === 'error' ? (
        <div className="mt-1 truncate text-[11px] text-[var(--danger)]">{t.error}</div>
      ) : (
        <>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--content-bg)]">
            <div
              className={`h-full rounded-full transition-all ${
                t.phase === 'done' ? 'bg-emerald-500' : 'bg-[var(--accent)]'
              }`}
              style={{ width: `${pct(t)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-[var(--text-muted)]">
            <span>
              {t.phase === 'scan'
                ? `扫描中… ${t.totalFiles} 个文件`
                : `${t.doneFiles}/${t.totalFiles} 文件`}
            </span>
            <span>
              {formatBytes(t.doneBytes)}
              {t.totalBytes > 0 ? ` / ${formatBytes(t.totalBytes)}` : ''}
            </span>
          </div>
          {active && t.phase === 'transfer' && t.speed > 0 && (
            <div className="mt-0.5 flex justify-between text-[11px] text-[var(--text-muted)]">
              <span>{formatSpeed(t.speed)}</span>
              {t.totalBytes > 0 && (
                <span>剩余 {formatEta((t.totalBytes - t.doneBytes) / t.speed)}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Collapsible transfer-records dock, scoped to one window (ownerId). Shows active
 * transfers and keeps finished ones as history until cleared. Renders nothing when
 * the window has no records.
 */
export function TransfersPanel({ ownerId }: { ownerId: string }): React.ReactElement | null {
  const items = useTransfersStore((s) => s.items)
  const collapsedMap = useTransfersStore((s) => s.collapsed)
  const setCollapsed = useTransfersStore((s) => s.setCollapsed)
  const clearFinished = useTransfersStore((s) => s.clearFinished)

  const mine = items.filter((i) => i.ownerId === ownerId)
  if (mine.length === 0) return null

  // Newest first; active transfers always float to the top.
  const sorted = [...mine].sort((a, b) => {
    const aa = isActivePhase(a.phase) ? 1 : 0
    const bb = isActivePhase(b.phase) ? 1 : 0
    if (aa !== bb) return bb - aa
    return b.startedAt - a.startedAt
  })
  const activeCount = mine.filter((i) => isActivePhase(i.phase)).length
  const doneCount = mine.length - activeCount
  const collapsed = collapsedMap[ownerId] ?? false

  return (
    <div className="pointer-events-auto absolute bottom-0 left-0 right-0 z-[80] border-t border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      <div className="flex h-9 items-center gap-2 px-3">
        <button
          onClick={() => setCollapsed(ownerId, !collapsed)}
          className="flex flex-1 items-center gap-2 text-left"
          title={collapsed ? '展开传输记录' : '折叠传输记录'}
        >
          {collapsed ? (
            <ChevronUp size={14} className="text-[var(--text-muted)]" />
          ) : (
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          )}
          <span className="text-xs font-semibold text-[var(--text-dark)]">传输</span>
          <span className="text-[11px] text-[var(--text-muted)]">
            {activeCount > 0 && `${activeCount} 进行中`}
            {activeCount > 0 && doneCount > 0 && ' · '}
            {doneCount > 0 && `${doneCount} 已完成`}
          </span>
          {activeCount > 0 && <Loader2 size={12} className="animate-spin text-[var(--accent)]" />}
        </button>
        {doneCount > 0 && (
          <button
            onClick={() => clearFinished(ownerId)}
            title="清除已完成记录"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <Trash2 size={12} />
            清除已完成
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="max-h-64 divide-y divide-[var(--panel-border)] overflow-y-auto border-t border-[var(--panel-border)]">
          {sorted.map((t) => (
            <TransferRow key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}
