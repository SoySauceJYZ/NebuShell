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

export type TabKind =
  | 'hosts'
  | 'keychain'
  | 'history'
  | 'settings'
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
  // sftp-backed editor tabs
  editorSftpSessionId?: string
  editorRemotePath?: string
  editorFileKey?: string
  editorFileName?: string
  // local-file-backed editor / image tabs
  editorLocalPath?: string
  imageLocalPath?: string
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
  setActiveTab: (id: string) => void
  setActivePane: (paneId: string) => void
  setDraggingTab: (id: string | null) => void
  moveTabToEdge: (tabId: string, targetPaneId: string, edge: Exclude<Edge, 'center'>) => void
  moveTabToPane: (tabId: string, targetPaneId: string) => void
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
      layout: addTabToPane(layout, targetPaneId, tab.id),
      activePaneId: targetPaneId,
      activeTabId: tab.id,
      ...(tab.kind === 'terminal' ? { lastActiveTerminalId: tab.id } : {})
    }))
  },

  closeTab: (id) => {
    if (id === 'hosts') return
    const { tabs, layout, activeTabId, activePaneId, lastActiveTerminalId } = get()
    const newTabs = tabs.filter((t) => t.id !== id)
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

  setSplitSizes: (splitId, sizes) => {
    set((state) => ({ layout: updateSizes(state.layout, splitId, sizes) }))
  }
}))
