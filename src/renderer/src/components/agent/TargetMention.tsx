import { useEffect, useRef } from 'react'
import { Box, Laptop, Server } from 'lucide-react'
import { targetKind, type AgentTarget } from '../../lib/agentTools'

/**
 * 输入框里的「@ 引用目标」菜单。用户敲 @ 之后列出当前可用目标(SSH 终端 / 容器 / 本机),
 * 选中即把目标名字原样插进草稿。判定与过滤的逻辑在 lib/targetMention.ts。
 */

function TargetIcon({ t }: { t: AgentTarget }): React.ReactElement {
  const kind = targetKind(t)
  const Icon = kind === 'local' ? Laptop : kind === 'container' ? Box : Server
  return <Icon size={13} className="shrink-0 text-[var(--accent)]" />
}

export function MentionPopup({
  targets,
  activeIndex,
  onPick,
  onHover
}: {
  targets: AgentTarget[]
  activeIndex: number
  onPick: (t: AgentTarget) => void
  onHover: (i: number) => void
}): React.ReactElement {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])
  return (
    <div className="absolute bottom-full left-0 z-[70] mb-1 max-h-[240px] w-full overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-[var(--text-muted)]">
        引用目标(↑↓ 选择,Enter / Tab 确认)
      </div>
      {targets.map((t, i) => (
        <button
          key={t.sessionId}
          type="button"
          ref={i === activeIndex ? activeRef : undefined}
          // mousedown 吃掉默认行为,输入框才不会先失焦(失焦会把菜单收起来,点击就落空了)。
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(t)
          }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
            i === activeIndex ? 'bg-[var(--nav-bg-hover)]' : ''
          }`}
        >
          <TargetIcon t={t} />
          <span className="min-w-0 flex-1 truncate text-[var(--text-dark)]">{t.name}</span>
          <span className="shrink-0 truncate text-[10px] text-[var(--text-muted)]">{t.host}</span>
        </button>
      ))}
    </div>
  )
}
