import { useEffect, useState } from 'react'
import { FolderOpen, HardDrive } from 'lucide-react'
import { buildMountsCommand, parseMountsOutput, type MountInfo } from '../../lib/dockerContainers'
import type { DockerCtx } from './ctx'

/**
 * 容器的挂载点一览。容器里那份数据在**宿主机上的哪个目录**,以前得自己 inspect
 * 再去 SFTP 里翻;这里直接列出来,一键在文件浏览器里打开那个目录。
 */
export function MountsModal({
  ctx,
  containerId,
  containerName,
  onOpenPath,
  onClose
}: {
  ctx: DockerCtx
  containerId: string
  containerName: string
  /** 在宿主机的 SFTP 文件浏览器里打开该目录。 */
  onOpenPath: (hostPath: string) => void
  onClose: () => void
}): React.ReactElement {
  const [mounts, setMounts] = useState<MountInfo[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ctx
      .query(buildMountsCommand(ctx.dockerCmd, containerId))
      .then((out) => {
        if (cancelled) return
        if (out === null) setError('读取挂载信息失败')
        else setMounts(parseMountsOutput(out))
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId])

  return (
    <div
      className="absolute inset-0 z-[90] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={onClose}
    >
      <div
        className="max-h-full w-full max-w-md overflow-auto rounded-[var(--radius)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-sm font-medium text-[var(--text-dark)]">挂载点</div>
        <div className="mb-3 truncate text-xs text-[var(--text-muted)]" title={containerName}>
          {containerName}
        </div>
        {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
        {!error && !mounts && <div className="text-xs text-[var(--text-muted)]">正在读取...</div>}
        {mounts && mounts.length === 0 && (
          <div className="text-xs text-[var(--text-muted)]">该容器没有挂载任何卷或目录。</div>
        )}
        <div className="flex flex-col gap-2">
          {mounts?.map((m) => (
            <div
              key={`${m.source}->${m.destination}`}
              className="rounded-[var(--radius-sm)] border border-[var(--panel-border)] p-2.5"
            >
              <div className="flex items-center gap-1.5">
                <HardDrive size={13} className="shrink-0 text-[var(--text-muted)]" />
                <span className="rounded bg-[var(--nav-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                  {m.type}
                </span>
                {!m.rw && (
                  <span className="rounded bg-[var(--nav-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    只读
                  </span>
                )}
              </div>
              <div className="mt-1.5 break-all font-mono text-[11px] text-[var(--text-dark)]">
                {m.destination}
              </div>
              <div className="mt-0.5 break-all font-mono text-[10px] text-[var(--text-muted)]">
                ← {m.source}
              </div>
              <button
                onClick={() => {
                  onOpenPath(m.source)
                  onClose()
                }}
                className="btn-secondary mt-2 px-2 py-1 text-xs"
              >
                <FolderOpen size={13} />
                在宿主机文件浏览器打开
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn-secondary px-3 py-1.5 text-xs">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
