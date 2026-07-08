import type { ITheme } from '@xterm/xterm'

export interface TerminalThemePreset {
  id: string
  name: string
  wrapperBg: string
  theme: ITheme
}

export const TERMINAL_THEMES: TerminalThemePreset[] = [
  {
    id: 'dark',
    name: '深色',
    wrapperBg: '#0f1117',
    theme: {
      background: '#0f1117',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#33415580'
    }
  },
  {
    id: 'midnight',
    name: '午夜黑',
    wrapperBg: '#000000',
    theme: {
      background: '#000000',
      foreground: '#e0e0e0',
      cursor: '#ffffff',
      selectionBackground: '#44444480'
    }
  },
  {
    id: 'solarized',
    name: 'Solarized',
    wrapperBg: '#002b36',
    theme: {
      background: '#002b36',
      foreground: '#93a1a1',
      cursor: '#93a1a1',
      selectionBackground: '#073642'
    }
  },
  {
    id: 'sand',
    name: '暖沙浅色',
    wrapperBg: '#f7f6f2',
    theme: {
      background: '#f7f6f2',
      foreground: '#2b2a27',
      cursor: '#c1633d',
      selectionBackground: '#e0dbcf'
    }
  }
]

export const DEFAULT_THEME_ID = 'sand'

export function getTheme(id: string): TerminalThemePreset {
  return TERMINAL_THEMES.find((t) => t.id === id) ?? TERMINAL_THEMES[0]
}
