import { useEffect, useState } from 'react'

/** Read-only local image preview (loaded as a base64 data URL, never file://). */
export function ImagePreviewTab({
  localPath,
  fileName
}: {
  localPath: string
  fileName?: string
}): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setError('')
    window.api.local
      .readFileBase64(localPath)
      .then(({ base64, mime }) => {
        if (!cancelled) setSrc(`data:${mime};base64,${base64}`)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [localPath])

  return (
    <div className="flex h-full flex-col bg-[var(--content-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 py-2 text-sm">
        <span className="truncate font-medium text-[var(--text-dark)]">{fileName ?? localPath}</span>
        <span className="truncate font-mono text-xs text-[var(--text-muted)]">{localPath}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {error ? (
          <div className="text-sm text-red-500">{error}</div>
        ) : src ? (
          <img src={src} alt={fileName ?? ''} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-sm text-[var(--text-muted)]">加载中…</div>
        )}
      </div>
    </div>
  )
}
