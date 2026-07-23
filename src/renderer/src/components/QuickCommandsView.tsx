import { useEffect } from 'react'
import { Zap, Server, Play, Terminal } from 'lucide-react'
import { useQuickCommandsStore } from '../store/useQuickCommandsStore'
import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import { runQuickCommand } from '../lib/quickCommands'
import type { QuickCommand } from '@shared/types'

/**
 * Left-nav「快捷操作」页:列出所有**绑定了服务器**的快捷命令(模式2)。
 * 点击一条 → 新开标签页连接对应服务器并自动执行该批命令。
 */
export function QuickCommandsView(): React.ReactElement {
  const items = useQuickCommandsStore((s) => s.items)
  const hydrate = useQuickCommandsStore((s) => s.hydrate)
  const hosts = useVaultStore((s) => s.hosts)
  const openTab = useSessionStore((s) => s.openTab)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const bound = items.filter((c) => c.hostId)

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-1 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <Zap size={20} strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-dark)]">快捷操作</h1>
          <p className="text-xs text-[var(--text-muted)]">
            绑定服务器的快捷命令,点击即新开标签页连接并执行。
          </p>
        </div>
      </div>

      {bound.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <Terminal size={32} className="text-[var(--text-muted)]" strokeWidth={1.5} />
          <p className="text-sm text-[var(--text-muted)]">暂无绑定服务器的快捷命令</p>
          <p className="max-w-sm text-xs text-[var(--text-muted)]">
            在终端右侧「快捷操作」面板中新增命令并选择一台服务器,即可在此一键连接并执行。
          </p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {bound.map((cmd) => (
            <QuickCommandCard
              key={cmd.id}
              cmd={cmd}
              hostLabel={hosts.find((h) => h.id === cmd.hostId)?.label}
              onRun={() => runQuickCommand(cmd, { sessionId: '', openTab, hosts })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QuickCommandCard({
  cmd,
  hostLabel,
  onRun
}: {
  cmd: QuickCommand
  hostLabel?: string
  onRun: () => void
}): React.ReactElement {
  const missing = !hostLabel
  const lines = cmd.commands
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  return (
    <button
      onClick={onRun}
      disabled={missing}
      title={missing ? '绑定的服务器已删除' : `连接「${hostLabel}」并执行`}
      className="group flex flex-col rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 text-left transition hover:border-[var(--accent)] hover:shadow-sm disabled:opacity-50"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <Play size={16} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--text-dark)]">{cmd.title}</div>
          <span className="mt-1 inline-flex items-center gap-1 rounded bg-[var(--content-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
            <Server size={11} />
            {hostLabel ?? '服务器已删除'}
          </span>
        </div>
      </div>

      {cmd.description && (
        <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-[var(--text-muted)]">
          {cmd.description}
        </p>
      )}

      {lines.length > 0 && (
        <div className="mt-2.5 space-y-0.5 rounded-lg bg-[var(--content-bg)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
          {lines.slice(0, 3).map((l, i) => (
            <div key={i} className="truncate">
              <span className="text-[var(--accent)]">$</span> {l}
            </div>
          ))}
          {lines.length > 3 && <div className="text-[10px]">…共 {lines.length} 条命令</div>}
        </div>
      )}
    </button>
  )
}
