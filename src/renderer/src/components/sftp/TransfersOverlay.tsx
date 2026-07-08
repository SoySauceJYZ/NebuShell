import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTransfersStore } from '../../store/useTransfersStore'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function TransfersOverlay(): React.ReactElement | null {
  const items = useTransfersStore((s) => s.items)
  const remove = useTransfersStore((s) => s.remove)
  if (items.length === 0) return null

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-[80] flex w-80 flex-col gap-2">
      {items.map((t) => {
        const pct =
          t.totalBytes > 0
            ? Math.min(100, Math.round((t.doneBytes / t.totalBytes) * 100))
            : t.phase === 'done'
              ? 100
              : 0
        return (
          <div
            key={t.id}
            className="pointer-events-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3 shadow-lg"
          >
            <div className="flex items-center gap-2">
              {t.phase === 'error' ? (
                <AlertCircle size={15} className="shrink-0 text-[var(--danger)]" />
              ) : t.phase === 'done' ? (
                <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
              ) : (
                <Loader2 size={15} className="shrink-0 animate-spin text-[var(--accent)]" />
              )}
              <span className="flex-1 truncate text-sm font-medium text-[var(--text-dark)]">
                {t.label}
              </span>
              <button
                onClick={() => remove(t.id)}
                className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
              >
                <X size={13} />
              </button>
            </div>

            {t.phase === 'error' ? (
              <div className="mt-1 truncate text-xs text-[var(--danger)]">{t.error}</div>
            ) : (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--content-bg)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all"
                    style={{ width: `${pct}%` }}
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
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
