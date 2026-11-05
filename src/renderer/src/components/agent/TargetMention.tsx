import { useEffect, useRef } from 'react'
import { Box, Laptop, MessagesSquare, Server } from 'lucide-react'
import { targetKind, type AgentTarget } from '../../lib/agentTools'
import { relativeTime, type MentionItem } from '../../lib/targetMention'

/**
 * 输入框里的「@ 引用」菜单。分两组:
 * - 目标(SSH 终端 / 容器 / 本机):选中即把目标名字原样插进草稿;
 * - 历史会话:选中即作为引用附件挂到这条消息上,发送时把会话记录交给模型做背景。
 * 判定与过滤的逻辑在 lib/targetMention.ts。
 */

function TargetIcon({ t }: { t: AgentTarget }): React.ReactElement {
  const kind = targetKind(t)
  const Icon = kind === 'local' ? Laptop : kind === 'container' ? Box : Server
  return <Icon size={13} className="shrink-0 text-[var(--accent)]" />
}

function itemKey(it: MentionItem): string {
  return it.kind === 'target' ? `t:${it.target.sessionId}` : `c:${it.conv.hostId}/${it.conv.id}`
}

export function MentionPopup({
  items,
  activeIndex,
  onPick,
  onHover,
  hostLabel,
  currentHostId
}: {
  items: MentionItem[]
  activeIndex: number
  onPick: (it: MentionItem) => void
  onHover: (i: number) => void
  hostLabel: (hostId: string) => string
  currentHostId: string
}): React.ReactElement {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])
  const firstConv = items.findIndex((it) => it.kind === 'conv')
  const hasTargets = items.some((it) => it.kind === 'target')
  return (
    <div className="absolute bottom-full left-0 z-[70] mb-1 max-h-[300px] w-full overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
      <div className="flex items-center px-2.5 pb-1 pt-1.5 text-[11px] text-[var(--text-muted)]">
        {hasTargets ? '引用目标' : '引用历史会话'}
        <span className="ml-auto">↑↓ 选择 · Enter / Tab 确认</span>
      </div>
      {items.map((it, i) => (
        <div key={itemKey(it)}>
          {i === firstConv && hasTargets && (
            <div className="mt-1 border-t border-[var(--panel-border)] px-2.5 pb-1 pt-1.5 text-[11px] text-[var(--text-muted)]">
              引用历史会话(作为背景上下文)
            </div>
          )}
          <button
            type="button"
            ref={i === activeIndex ? activeRef : undefined}
            // mousedown 吃掉默认行为,输入框才不会先失焦(失焦会把菜单收起来,点击就落空了)。
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(it)
            }}
            onMouseEnter={() => onHover(i)}
            className={`flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
              i === activeIndex ? 'bg-[var(--nav-bg-hover)]' : ''
            }`}
          >
            {it.kind === 'target' ? (
              <>
                <TargetIcon t={it.target} />
                <span className="min-w-0 flex-1 truncate text-[var(--text-dark)]">
                  {it.target.name}
                </span>
                <span className="shrink-0 truncate text-[10px] text-[var(--text-muted)]">
                  {it.target.host}
                </span>
              </>
            ) : (
              <>
                <MessagesSquare size={13} className="shrink-0 text-[var(--accent)]" />
                <span className="min-w-0 flex-1 truncate text-[var(--text-dark)]">
                  {it.conv.title}
                </span>
                <span className="max-w-[45%] shrink-0 truncate text-[10px] text-[var(--text-muted)]">
                  {it.conv.hostId === currentHostId ? '本主机' : hostLabel(it.conv.hostId)} ·{' '}
                  {relativeTime(it.conv.updatedAt)}
                </span>
              </>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}
