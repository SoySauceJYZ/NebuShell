import { Server, KeyRound, FileClock, Settings, Zap } from 'lucide-react'
import { useSessionStore, type TabKind } from '../store/useSessionStore'

const NAV_ITEMS: {
  id: Extract<TabKind, 'hosts' | 'keychain' | 'history' | 'quickCommands' | 'settings'>
  label: string
  icon: typeof Server
}[] = [
  { id: 'hosts', label: '主机', icon: Server },
  { id: 'keychain', label: '密钥库', icon: KeyRound },
  { id: 'quickCommands', label: '快捷操作', icon: Zap },
  { id: 'history', label: '历史文档', icon: FileClock },
  { id: 'settings', label: '设置', icon: Settings }
]

export function Sidebar(): React.ReactElement {
  const { activeTabId, openTab } = useSessionStore()

  return (
    <div className="flex w-16 flex-col items-center gap-1.5 border-r border-[var(--nav-border)] bg-[var(--nav-bg)] py-3">
      {NAV_ITEMS.map((item) => {
        const active = activeTabId === item.id
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={() =>
              openTab({
                id: item.id,
                kind: item.id,
                title: item.label
              })
            }
            title={item.label}
            className={`flex w-12 flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] transition ${
              active
                ? 'bg-[var(--nav-active-bg)] text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]'
            }`}
          >
            <Icon size={19} strokeWidth={1.75} />
            {item.label}
          </button>
        )
      })}

      {/* Footer credit */}
      <div className="mt-auto flex flex-col items-center px-1 pt-2 text-center">
        <span className="text-[8px] leading-tight text-[var(--text-muted)]">Powered By</span>
        <span className="text-[9px] font-medium leading-tight text-[var(--text-muted)]">
          Mrtoken
        </span>
      </div>
    </div>
  )
}
