import { Server, KeyRound, FileClock, Settings, Zap, Monitor } from 'lucide-react'
import { useSessionStore, type TabKind } from '../store/useSessionStore'
import { useUpdateStore } from '../store/useUpdateStore'

const NAV_ITEMS: {
  id: Extract<
    TabKind,
    'hosts' | 'keychain' | 'history' | 'quickCommands' | 'settings' | 'remoteDesktop'
  >
  label: string
  icon: typeof Server
}[] = [
  { id: 'hosts', label: '主机', icon: Server },
  { id: 'keychain', label: '密钥库', icon: KeyRound },
  { id: 'quickCommands', label: '快捷操作', icon: Zap },
  { id: 'remoteDesktop', label: '远程桌面', icon: Monitor },
  { id: 'history', label: '历史文档', icon: FileClock },
  { id: 'settings', label: '设置', icon: Settings }
]

export function Sidebar(): React.ReactElement {
  const { activeTabId, openTab } = useSessionStore()
  // 设置页里放着更新检查,有未看过的新版本就在图标上点个红点。
  const updateBadge = useUpdateStore((s) => Boolean(s.info?.hasUpdate) && !s.seen)

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
            className={`relative flex w-12 flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] transition ${
              active
                ? 'bg-[var(--nav-active-bg)] text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]'
            }`}
          >
            <Icon size={19} strokeWidth={1.75} />
            {item.label}
            {item.id === 'settings' && updateBadge && (
              <span
                className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-[var(--danger)]"
                title="有新版本可用"
              />
            )}
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
