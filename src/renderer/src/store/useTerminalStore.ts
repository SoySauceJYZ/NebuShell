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
  /**
   * Which right-side panel section is open, per session (null/absent = collapsed).
   * Kept per-terminal so opening SFTP/容器/主题 in one tab doesn't switch the others.
   */
  rightPanelTabBySession: Record<string, RightPanelTab>
  getRightPanelTab: (sessionId: string) => RightPanelTab
  toggleRightPanel: (sessionId: string, tab: Exclude<RightPanelTab, null>) => void
  /** 显式打开某个面板(不做 toggle),用于主机页「查看容器」等直达入口。 */
  setRightPanel: (sessionId: string, tab: RightPanelTab) => void

  /** Draggable width of the right-side panel (shared across terminals). */
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
  rightPanelTabBySession: {},
  getRightPanelTab: (sessionId) => get().rightPanelTabBySession[sessionId] ?? null,
  toggleRightPanel: (sessionId, tab) =>
    set((state) => ({
      rightPanelTabBySession: {
        ...state.rightPanelTabBySession,
        [sessionId]: state.rightPanelTabBySession[sessionId] === tab ? null : tab
      }
    })),
  setRightPanel: (sessionId, tab) =>
    set((state) => ({
      rightPanelTabBySession: { ...state.rightPanelTabBySession, [sessionId]: tab }
    })),

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
