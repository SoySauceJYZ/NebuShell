import { X, SplitSquareHorizontal, SplitSquareVertical } from 'lucide-react'
import { useSessionStore, type PaneNode } from '../store/useSessionStore'
import { KIND_ICON } from '../lib/tabIcons'
import { requestCloseTab } from '../lib/requestCloseTab'
import { startTabDrag } from '../lib/tabDrag'

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
  const splitPane = useSessionStore((s) => s.splitPane)

  return (
    <div
      className={`flex h-8 items-center border-b px-1.5 ${
        isActivePane
          ? 'border-[var(--panel-border)] bg-[var(--panel-bg)]'
          : 'border-[var(--panel-border)] bg-[var(--nav-bg)]'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {pane.tabIds.map((tabId) => {
          const tab = tabs.find((t) => t.id === tabId)
          if (!tab) return null
          const Icon = KIND_ICON[tab.kind]
          const active = pane.activeTabId === tabId
          return (
            <div
              key={tabId}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void requestCloseTab(tabId)
                  return
                }
                if (e.button !== 0) return
                setActiveTab(tabId)
                startTabDrag(tabId, e.clientX, e.clientY)
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
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void requestCloseTab(tabId)
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

      {/* Split this pane into a new adjacent pane. */}
      <div className="ml-1 flex shrink-0 items-center gap-0.5">
        <button
          title="向右分屏"
          onClick={() => splitPane(pane.id, 'right')}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]"
        >
          <SplitSquareHorizontal size={14} strokeWidth={1.75} />
        </button>
        <button
          title="向下分屏"
          onClick={() => splitPane(pane.id, 'bottom')}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]"
        >
          <SplitSquareVertical size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
