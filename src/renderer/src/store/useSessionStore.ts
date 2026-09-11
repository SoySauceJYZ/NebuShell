import { create } from 'zustand'
import {
  addTabToPane,
  findPane,
  firstPane,
  insertSplitAt,
  newId,
  paneOfTab,
  pruneEmpty,
  removeTabFromTree,
  setPaneActive,
  updateSizes,
  type Edge
} from '../lib/layoutTree'
import { markDetaching } from '../lib/detachRegistry'

export type TabKind =
  | 'hosts'
  | 'keychain'
  | 'history'
  | 'quickCommands'
  | 'settings'
  | 'remoteDesktop'
  | 'terminal'
  | 'sftp'
  | 'explorer'
  | 'editor'
  | 'image'

export interface Tab {
  id: string
  kind: TabKind
  title: string
  hostId?: string
  // editor tabs
  editorContent?: string
  editorExecCommand?: string
  editorSourceSessionId?: string
  editorLang?: string
  /** 只读编辑器(如容器日志):禁止编辑,只能查看/刷新/复制。 */
  editorReadOnly?: boolean
  // sftp-backed editor tabs
  editorSftpSessionId?: string
  editorRemotePath?: string
  editorFileKey?: string
  editorFileName?: string
  // local-file-backed editor / image tabs
  editorLocalPath?: string
  imageLocalPath?: string
  // 容器终端 tab(kind:'terminal' + containerId → docker exec -it 进容器)
  containerId?: string
  containerName?: string
  /** 打开时探测到的 docker 调用前缀('docker' | 'sudo -n docker')。 */
  dockerCmd?: string
  /** 容器终端的 exec 选项:以指定用户 / 工作目录 / shell 进入(留空即默认)。 */
  containerUser?: string
  containerWorkdir?: string
  containerShell?: string
  /** 该「容器终端」其实是 docker logs -f 的跟随窗口(Ctrl-C 退出,关掉即断)。 */
  containerLogsFollow?: boolean
  containerLogsTail?: number | 'all'
  containerLogsTimestamps?: boolean
  /** 容器日志编辑器 tab:有值时工具栏出现行数 / 时间戳 / 自动刷新控件。 */
  editorLogTarget?: string
  editorLogDockerCmd?: string
  /** 整页文件浏览器里,预置的远程面板打开时定位到的目录(由侧边栏「展开」带过来)。 */
  explorerInitialPath?: string
  // 容器文件浏览器:explorer tab 预置一个容器面板
  explorerContainerId?: string
  explorerContainerName?: string
  // 容器文件后端的编辑器 tab
  editorContainerFsSessionId?: string
  // 服务器绑定的快捷命令:新开的终端首次连接成功后自动写入并执行的一批命令。
  initialCommands?: string
  // Transient: set when this tab was adopted from another window. Tells TerminalTab /
  // RemotePane the session is already alive in main — replay/reuse it, don't reconnect.
  adopted?: boolean
}

// ---- content-area layout tree (panes + row/column splits) ----

export interface PaneNode {
  type: 'pane'
  id: string
  tabIds: string[]
  activeTabId: string
}
export interface SplitNode {
  type: 'split'
  id: string
  direction: 'row' | 'column'
  children: LayoutNode[]
  sizes: number[]
}
export type LayoutNode = PaneNode | SplitNode

interface SessionState {
  tabs: Tab[]
  layout: LayoutNode
  /** The pane new tabs open into and that owns keyboard/agent focus. */
  activePaneId: string
  activeTabId: string
  /** The most recently active terminal tab — the agent targets this session. */
  lastActiveTerminalId?: string
  /** Id of the tab currently being dragged (for split drop targets), if any. */
  draggingTabId?: string

  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  /** Insert a tab torn off from another window into the active pane (marks it adopted). */
  adoptTab: (tab: Tab) => void
  /** Clear the transient adopted flag once the tab's component has consumed it. */
  clearAdopted: (id: string) => void
  /** Remove a tab locally for a tear-off — keeps the session alive (no disconnect). */
  detachTabLocal: (id: string) => void
  setActiveTab: (id: string) => void
  setActivePane: (paneId: string) => void
  setDraggingTab: (id: string | null) => void
  moveTabToEdge: (tabId: string, targetPaneId: string, edge: Exclude<Edge, 'center'>) => void
  moveTabToPane: (tabId: string, targetPaneId: string) => void
  /** Split a pane on the given edge, creating a new adjacent pane. */
  splitPane: (paneId: string, edge: Exclude<Edge, 'center'>) => void
  setSplitSizes: (splitId: string, sizes: number[]) => void
}

const ROOT_PANE_ID = 'pane-root'
const HOSTS_TAB: Tab = { id: 'hosts', kind: 'hosts', title: 'Hosts' }

function makeRootLayout(): PaneNode {
  return { type: 'pane', id: ROOT_PANE_ID, tabIds: ['hosts'], activeTabId: 'hosts' }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [HOSTS_TAB],
  layout: makeRootLayout(),
  activePaneId: ROOT_PANE_ID,
  activeTabId: 'hosts',
  lastActiveTerminalId: undefined,
  draggingTabId: undefined,

  openTab: (tab) => {
    const { tabs, layout, activePaneId } = get()
    const existing = tabs.find((t) => t.id === tab.id)
    if (existing) {
      const pane = paneOfTab(layout, tab.id)
      set({
        activeTabId: tab.id,
        activePaneId: pane?.id ?? activePaneId,
        layout: pane ? setPaneActive(layout, pane.id, tab.id) : layout,
        ...(existing.kind === 'terminal' ? { lastActiveTerminalId: tab.id } : {})
      })
      return
    }
    // Target pane must still exist; fall back to the first pane.
    const targetPaneId = findPane(layout, activePaneId) ? activePaneId : firstPane(layout).id
    set((state) => ({
      tabs: [...state.tabs, tab],
      // 插在当前 tab 之后,而不是末尾 —— 关掉新 tab 就回到打开它的那个。
      // (拖拽落到别的 pane 走 moveTabToPane,那里仍然是末尾追加。)
      layout: addTabToPane(layout, targetPaneId, tab.id, 'afterActive'),
      activePaneId: targetPaneId,
      activeTabId: tab.id,
      ...(tab.kind === 'terminal' ? { lastActiveTerminalId: tab.id } : {})
    }))
  },

  closeTab: (id) => {
    const { tabs, layout, activeTabId, activePaneId, lastActiveTerminalId } = get()
    // Hosts 是「首页」,平时不给关;分屏后它占着一整个 pane,允许关掉 —— 但不能关成空窗口。
    // 侧边栏「主机」和标签栏「+ → 打开新主机」都走 openTab,随时能把它开回来。
    if (id === 'hosts' && tabs.length <= 1) return
    const newTabs = tabs.filter((t) => t.id !== id)
    // 关掉最后一个 tab(Hosts 先前被关掉时才可能发生):回到只有 Hosts 的初始布局,
    // 而不是留一个空窗口。
    if (newTabs.length === 0) {
      set({
        tabs: [HOSTS_TAB],
        layout: makeRootLayout(),
        activePaneId: ROOT_PANE_ID,
        activeTabId: 'hosts',
        lastActiveTerminalId: undefined
      })
      return
    }
    const pruned = pruneEmpty(removeTabFromTree(layout, id))
    const newLayout = pruned ?? makeRootLayout()

    let newActiveTab = activeTabId
    let newActivePane = activePaneId
    if (activeTabId === id || !paneOfTab(newLayout, activeTabId)) {
      // active tab was closed (or its pane vanished) — focus a surviving pane.
      const focusPane = findPane(newLayout, activePaneId) ?? firstPane(newLayout)
      newActivePane = focusPane.id
      newActiveTab = focusPane.activeTabId
    } else if (!findPane(newLayout, activePaneId)) {
      newActivePane = paneOfTab(newLayout, activeTabId)?.id ?? firstPane(newLayout).id
    }

    let newLastTerm = lastActiveTerminalId
    if (lastActiveTerminalId === id) {
      newLastTerm = [...newTabs].reverse().find((t) => t.kind === 'terminal')?.id
    }

    set({
      tabs: newTabs,
      layout: newLayout,
      activeTabId: newActiveTab,
      activePaneId: newActivePane,
      lastActiveTerminalId: newLastTerm
    })
  },

  adoptTab: (tab) => {
    // Reuse openTab's insertion, but stamp `adopted` so the session is reused, not reconnected.
    get().openTab({ ...tab, adopted: true })
  },

  clearAdopted: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, adopted: false } : t))
    })),

  detachTabLocal: (id) => {
    // The tab id is the session id (see TabContent). Suppress the disconnect that this
    // tab's component would otherwise fire on unmount, then remove it like closeTab.
    markDetaching(id)
    get().closeTab(id)
  },

  setActiveTab: (id) => {
    const { layout, tabs } = get()
    const pane = paneOfTab(layout, id)
    if (!pane) return
    const tab = tabs.find((t) => t.id === id)
    set({
      layout: setPaneActive(layout, pane.id, id),
      activeTabId: id,
      activePaneId: pane.id,
      ...(tab?.kind === 'terminal' ? { lastActiveTerminalId: id } : {})
    })
  },

  setActivePane: (paneId) => {
    const { layout } = get()
    const pane = findPane(layout, paneId)
    if (!pane) return
    set({ activePaneId: paneId, activeTabId: pane.activeTabId })
  },

  setDraggingTab: (id) => set({ draggingTabId: id ?? undefined }),

  moveTabToEdge: (tabId, targetPaneId, edge) => {
    const { layout } = get()
    const src = paneOfTab(layout, tabId)
    if (!src) return
    // Dragging a pane's only tab onto its own edge would just recreate itself.
    if (src.id === targetPaneId && src.tabIds.length === 1) return
    const removed = pruneEmpty(removeTabFromTree(layout, tabId))
    if (!removed) return
    const newPane: PaneNode = {
      type: 'pane',
      id: newId('pane'),
      tabIds: [tabId],
      activeTabId: tabId
    }
    set({
      layout: insertSplitAt(removed, targetPaneId, newPane, edge),
      activePaneId: newPane.id,
      activeTabId: tabId,
      draggingTabId: undefined
    })
  },

  moveTabToPane: (tabId, targetPaneId) => {
    const { layout } = get()
    const src = paneOfTab(layout, tabId)
    if (!src) return
    if (src.id === targetPaneId) {
      set({
        layout: setPaneActive(layout, targetPaneId, tabId),
        activePaneId: targetPaneId,
        activeTabId: tabId,
        draggingTabId: undefined
      })
      return
    }
    const removed = pruneEmpty(removeTabFromTree(layout, tabId))
    if (!removed) return
    set({
      layout: addTabToPane(removed, targetPaneId, tabId),
      activePaneId: targetPaneId,
      activeTabId: tabId,
      draggingTabId: undefined
    })
  },

  splitPane: (paneId, edge) => {
    const { layout, tabs } = get()
    const pane = findPane(layout, paneId)
    if (!pane) return
    const activeId = pane.activeTabId
    const activeTab = tabs.find((t) => t.id === activeId)

    // A pane with several tabs splits by moving its active tab into the new pane.
    if (pane.tabIds.length > 1) {
      const removed = pruneEmpty(removeTabFromTree(layout, activeId))
      if (!removed) return
      const newPane: PaneNode = {
        type: 'pane',
        id: newId('pane'),
        tabIds: [activeId],
        activeTabId: activeId
      }
      set({
        layout: insertSplitAt(removed, paneId, newPane, edge),
        activePaneId: newPane.id,
        activeTabId: activeId
      })
      return
    }

    // A single-tab pane keeps its tab and gets a fresh sibling: a duplicate
    // terminal (new session on the same host) or a blank editor otherwise.
    const newTab: Tab =
      activeTab?.kind === 'terminal' && activeTab.hostId
        ? {
            id: `terminal-${activeTab.hostId}-${Date.now()}`,
            kind: 'terminal',
            title: activeTab.title,
            hostId: activeTab.hostId,
            // 容器终端分屏复制时保留容器上下文
            containerId: activeTab.containerId,
            containerName: activeTab.containerName,
            dockerCmd: activeTab.dockerCmd
          }
        : {
            id: `editor-blank-${Date.now()}`,
            kind: 'editor',
            title: '未命名',
            editorContent: '',
            editorLang: 'plaintext'
          }
    const newPane: PaneNode = {
      type: 'pane',
      id: newId('pane'),
      tabIds: [newTab.id],
      activeTabId: newTab.id
    }
    set({
      tabs: [...tabs, newTab],
      layout: insertSplitAt(layout, paneId, newPane, edge),
      activePaneId: newPane.id,
      activeTabId: newTab.id,
      ...(newTab.kind === 'terminal' ? { lastActiveTerminalId: newTab.id } : {})
    })
  },

  setSplitSizes: (splitId, sizes) => {
    set((state) => ({ layout: updateSizes(state.layout, splitId, sizes) }))
  }
}))
