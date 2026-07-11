import { Fragment } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as ContextMenu from '@radix-ui/react-context-menu'
import {
  Server,
  FileText,
  X,
  Plus,
  Copy,
  RotateCw,
  SplitSquareHorizontal,
  SplitSquareVertical
} from 'lucide-react'
import { useSessionStore, type Tab } from '../store/useSessionStore'
import { KIND_ICON } from '../lib/tabIcons'
import { requestCloseTab } from '../lib/requestCloseTab'
import { startTabDrag } from '../lib/tabDrag'
import { WindowControls } from './WindowControls'
import appIcon from '../assets/app-icon.png'

const isMac = window.electron.process.platform === 'darwin'
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function TabBar(): React.ReactElement {
  const { tabs, activeTabId, layout, activePaneId, setActiveTab, openTab, splitPane } =
    useSessionStore()
  // When the view is split, each pane renders its own strip, so the top bar
  // only keeps window chrome + the new-tab button.
  const isSplit = layout.type !== 'pane'

  const duplicateTerminal = (tab: Tab): void => {
    if (tab.kind !== 'terminal' || !tab.hostId) return
    openTab({
      id: `terminal-${tab.hostId}-${Date.now()}`,
      kind: 'terminal',
      title: tab.title,
      hostId: tab.hostId
    })
  }

  const openBlankEditor = (): void => {
    openTab({
      id: `editor-blank-${Date.now()}`,
      kind: 'editor',
      title: '未命名',
      editorContent: '',
      editorLang: 'plaintext'
    })
  }

  return (
    <div
      className="flex h-11 items-center gap-1 border-b border-[var(--nav-border)] bg-[var(--nav-bg)]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* leave room for macOS traffic lights on the left */}
      {isMac && <div className="w-[72px] shrink-0" />}
      <div className="w-3 shrink-0" />
      {/* App brand */}
      <div className="flex shrink-0 items-center gap-2 pr-2" style={noDrag} title="NebuShell">
        <img
          src={appIcon}
          alt="NebuShell"
          className="h-6 w-6 rounded-md object-contain drop-shadow-sm"
        />
        <span className="text-sm font-semibold text-[var(--text-dark)]">NebuShell</span>
      </div>
      <div className="mr-1 h-5 w-px shrink-0 bg-[var(--nav-border)]" />
      <div className="flex h-full flex-1 items-center gap-1 overflow-x-auto py-1.5">
        {!isSplit &&
          tabs.map((tab) => {
            const active = tab.id === activeTabId
            const Icon = KIND_ICON[tab.kind]
            const tabInner = (
              <div
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    void requestCloseTab(tab.id)
                    return
                  }
                  if (e.button !== 0) return
                  setActiveTab(tab.id)
                  startTabDrag(tab.id, e.clientX, e.clientY)
                }}
                style={noDrag}
                className={`group flex h-full min-w-[130px] max-w-[210px] cursor-pointer items-center gap-2 rounded-md px-3 text-sm transition ${
                  active
                    ? 'bg-[var(--panel-bg)] text-[var(--text-dark)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]'
                }`}
              >
                <Icon size={14} strokeWidth={1.75} className="shrink-0" />
                <span className="flex-1 truncate">{tab.title}</span>
                {tab.id !== 'hosts' && (
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void requestCloseTab(tab.id)
                    }}
                    className="rounded p-0.5 opacity-0 hover:bg-black/5 group-hover:opacity-100"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )

            // SSH (terminal) tabs get a right-click menu.
            if (tab.kind === 'terminal') {
              return (
                <ContextMenu.Root key={tab.id}>
                  <ContextMenu.Trigger asChild>{tabInner}</ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="z-[70] min-w-[160px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
                      <ContextMenu.Item
                        onSelect={() =>
                          window.dispatchEvent(new CustomEvent('ssh-reconnect', { detail: tab.id }))
                        }
                        className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                      >
                        <RotateCw
                          size={15}
                          strokeWidth={1.75}
                          className="text-[var(--text-muted)]"
                        />
                        重新连接
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onSelect={() => duplicateTerminal(tab)}
                        className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                      >
                        <Copy size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                        复制(新建相同连接)
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onSelect={() => void requestCloseTab(tab.id)}
                        className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                      >
                        <X size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                        关闭
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              )
            }
            return <Fragment key={tab.id}>{tabInner}</Fragment>
          })}

        {/* New-tab (+) button */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              style={noDrag}
              title="新建"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]"
            >
              <Plus size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className="z-[70] min-w-[180px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
            >
              <DropdownMenu.Item
                onSelect={() => setActiveTab('hosts')}
                className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
              >
                <Server size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                打开新主机
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={openBlankEditor}
                className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
              >
                <FileText size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                打开空白编辑器
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Split the active pane. */}
        <button
          style={noDrag}
          title="向右分屏"
          onClick={() => splitPane(activePaneId, 'right')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]"
        >
          <SplitSquareHorizontal size={16} strokeWidth={1.75} />
        </button>
        <button
          style={noDrag}
          title="向下分屏"
          onClick={() => splitPane(activePaneId, 'bottom')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]"
        >
          <SplitSquareVertical size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div className="w-1 shrink-0" />
      <WindowControls />
    </div>
  )
}
