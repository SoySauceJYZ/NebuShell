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

/** 终端两侧各有一个面板停靠位,合起来就是「左 · 终端 · 右」三栏。 */
export type PanelSide = 'left' | 'right'

interface TerminalState {
  /**
   * Which right-side panel section is open, per session (null/absent = collapsed).
   * Kept per-terminal so opening SFTP/容器/主题 in one tab doesn't switch the others.
   */
  rightPanelTabBySession: Record<string, RightPanelTab>
  /** 左侧停靠位。面板从右侧移过来,或从这里移回去。 */
  leftPanelTabBySession: Record<string, RightPanelTab>
  getRightPanelTab: (sessionId: string) => RightPanelTab
  toggleRightPanel: (sessionId: string, tab: Exclude<RightPanelTab, null>) => void
  /** 显式打开某个面板(不做 toggle),用于主机页「查看容器」等直达入口。 */
  setRightPanel: (sessionId: string, tab: RightPanelTab) => void
  /**
   * 把 `from` 侧的面板挪到另一侧。两侧都有面板时就是互换 —— 目标侧的那个不会被丢掉。
   * `from` 侧为空时什么也不做。
   */
  movePanel: (sessionId: string, from: PanelSide) => void

  /** Draggable width of each dock (shared across terminals). */
  rightPanelWidth: number
  setRightPanelWidth: (w: number) => void
  leftPanelWidth: number
  setLeftPanelWidth: (w: number) => void

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
  leftPanelTabBySession: {},
  getRightPanelTab: (sessionId) => get().rightPanelTabBySession[sessionId] ?? null,
  toggleRightPanel: (sessionId, tab) =>
    set((state) => {
      // 同一个面板不能同时停在两侧(SFTP / 容器文件那类面板共用一条 session id,
      // 开两份会互相打架)。它已经在左边时,点图标就按 toggle 语义把它关掉。
      if (state.leftPanelTabBySession[sessionId] === tab) {
        return { leftPanelTabBySession: { ...state.leftPanelTabBySession, [sessionId]: null } }
      }
      return {
        rightPanelTabBySession: {
          ...state.rightPanelTabBySession,
          [sessionId]: state.rightPanelTabBySession[sessionId] === tab ? null : tab
        }
      }
    }),
  setRightPanel: (sessionId, tab) =>
    set((state) => ({
      rightPanelTabBySession: { ...state.rightPanelTabBySession, [sessionId]: tab }
    })),
  movePanel: (sessionId, from) =>
    set((state) => {
      const left = state.leftPanelTabBySession[sessionId] ?? null
      const right = state.rightPanelTabBySession[sessionId] ?? null
      if (!(from === 'left' ? left : right)) return state
      // 无论单向搬运还是两侧都有,结果都是两个停靠位对调。
      return {
        leftPanelTabBySession: { ...state.leftPanelTabBySession, [sessionId]: right },
        rightPanelTabBySession: { ...state.rightPanelTabBySession, [sessionId]: left }
      }
    }),

  rightPanelWidth: DEFAULT_PANEL_WIDTH,
  setRightPanelWidth: (w) =>
    set({ rightPanelWidth: Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w)) }),
  leftPanelWidth: DEFAULT_PANEL_WIDTH,
  setLeftPanelWidth: (w) =>
    set({ leftPanelWidth: Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w)) }),

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
