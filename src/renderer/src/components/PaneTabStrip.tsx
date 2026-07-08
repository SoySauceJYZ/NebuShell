import { X } from 'lucide-react'
import { useSessionStore, type PaneNode } from '../store/useSessionStore'
import { KIND_ICON } from '../lib/tabIcons'

/** Compact tab strip rendered at the top of each pane when the view is split. */
export function PaneTabStrip({
  pane,
  isActivePane
}: {
  pane: PaneNode
  isActivePane: boolean
}): React.ReactElement {
  const tabs = useSessionStore((s) => s.tabs)
  const setActiveTab = useSessionStore((s) => s.setActiveTab)
  const closeTab = useSessionStore((s) => s.closeTab)
  const setDraggingTab = useSessionStore((s) => s.setDraggingTab)

  return (
    <div
      className={`flex h-8 items-center gap-1 overflow-x-auto border-b px-1.5 ${
        isActivePane
          ? 'border-[var(--panel-border)] bg-[var(--panel-bg)]'
          : 'border-[var(--panel-border)] bg-[var(--nav-bg)]'
      }`}
    >
      {pane.tabIds.map((tabId) => {
        const tab = tabs.find((t) => t.id === tabId)
        if (!tab) return null
        const Icon = KIND_ICON[tab.kind]
        const active = pane.activeTabId === tabId
        return (
          <div
            key={tabId}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/x-tab', tabId)
              e.dataTransfer.effectAllowed = 'move'
              setDraggingTab(tabId)
            }}
            onDragEnd={() => setDraggingTab(null)}
            onClick={() => setActiveTab(tabId)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                closeTab(tabId)
              }
            }}
            className={`group flex h-6 max-w-[160px] shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 text-xs transition ${
              active
                ? 'bg-[var(--content-bg)] text-[var(--text-dark)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]'
            }`}
          >
            <Icon size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="flex-1 truncate">{tab.title}</span>
            {tab.id !== 'hosts' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tabId)
                }}
                className="rounded p-0.5 opacity-0 hover:bg-black/5 group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
