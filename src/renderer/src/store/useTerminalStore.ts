import { create } from 'zustand'
import { DEFAULT_THEME_ID } from '../lib/terminalThemes'

export type RightPanelTab =
  | 'agent'
  | 'actions'
  | 'history'
  | 'monitor'
  | 'theme'
  | 'sftp'
  | 'docker'
  | null

export const DEFAULT_FONT_SIZE = 13
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 30

export const DEFAULT_PANEL_WIDTH = 340
export const MIN_PANEL_WIDTH = 280
export const MAX_PANEL_WIDTH = 900

interface TerminalState {
  /** Which right-side panel section is open (null = collapsed). Shared across terminals. */
  rightPanelTab: RightPanelTab
  toggleRightPanel: (tab: Exclude<RightPanelTab, null>) => void
  /** 显式打开某个面板(不做 toggle),用于主机页「查看容器」等直达入口。 */
  setRightPanel: (tab: RightPanelTab) => void

  /** Draggable width of the right-side panel (shared). */
  rightPanelWidth: number
  setRightPanelWidth: (w: number) => void

  /** Selected xterm theme per session. */
  themeBySession: Record<string, string>
  setTheme: (sessionId: string, themeId: string) => void
  getThemeId: (sessionId: string) => string

  /** Terminal font size per session (only affects the terminal, not the app UI). */
  fontSizeBySession: Record<string, number>
  setFontSize: (sessionId: string, size: number) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  rightPanelTab: null,
  toggleRightPanel: (tab) =>
    set((state) => ({ rightPanelTab: state.rightPanelTab === tab ? null : tab })),
  setRightPanel: (tab) => set({ rightPanelTab: tab }),

  rightPanelWidth: DEFAULT_PANEL_WIDTH,
  setRightPanelWidth: (w) =>
    set({ rightPanelWidth: Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w)) }),

  themeBySession: {},
  setTheme: (sessionId, themeId) =>
    set((state) => ({ themeBySession: { ...state.themeBySession, [sessionId]: themeId } })),
  getThemeId: (sessionId) => get().themeBySession[sessionId] ?? DEFAULT_THEME_ID,

  fontSizeBySession: {},
  setFontSize: (sessionId, size) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)))
    set((state) => ({
      fontSizeBySession: { ...state.fontSizeBySession, [sessionId]: clamped }
    }))
  }
}))
