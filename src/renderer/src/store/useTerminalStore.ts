import { create } from 'zustand'
import { DEFAULT_THEME_ID } from '../lib/terminalThemes'

export type RightPanelTab = 'agent' | 'actions' | 'history' | 'monitor' | 'theme' | 'sftp' | null

const MAX_HISTORY = 200

export const DEFAULT_FONT_SIZE = 13
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 30

export const DEFAULT_PANEL_WIDTH = 340
export const MIN_PANEL_WIDTH = 280
export const MAX_PANEL_WIDTH = 900

interface TerminalState {
  /** Recorded commands per terminal session (most recent last). */
  history: Record<string, string[]>
  addCommand: (sessionId: string, command: string) => void
  clearHistory: (sessionId: string) => void

  /** Which right-side panel section is open (null = collapsed). Shared across terminals. */
  rightPanelTab: RightPanelTab
  toggleRightPanel: (tab: Exclude<RightPanelTab, null>) => void

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
  history: {},
  addCommand: (sessionId, command) => {
    const trimmed = command.trim()
    if (!trimmed) return
    set((state) => {
      const prev = state.history[sessionId] ?? []
      // avoid consecutive duplicates
      if (prev[prev.length - 1] === trimmed) return state
      const next = [...prev, trimmed].slice(-MAX_HISTORY)
      return { history: { ...state.history, [sessionId]: next } }
    })
  },
  clearHistory: (sessionId) =>
    set((state) => ({ history: { ...state.history, [sessionId]: [] } })),

  rightPanelTab: null,
  toggleRightPanel: (tab) =>
    set((state) => ({ rightPanelTab: state.rightPanelTab === tab ? null : tab })),

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
