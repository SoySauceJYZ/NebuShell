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
      selectionBackground: '#33415580',
      black: '#1e1e1e',
      red: '#f14c4c',
      green: '#23d18b',
      yellow: '#dcdcaa',
      blue: '#3b8eea',
      magenta: '#d670d6',
      cyan: '#29b8db',
      white: '#d4d4d4',
      brightBlack: '#808080',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5'
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
      selectionBackground: '#44444480',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff'
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
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#93a1a1',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#94a1a1',
      brightWhite: '#fdf6e3'
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
      selectionBackground: '#e0dbcf',
      // 浅色背景：white / brightWhite 必须映射为深色，否则 ANSI 白字在浅底上看不见。
      black: '#2b2a27',
      red: '#b02222',
      green: '#4e7a27',
      yellow: '#9a6b00',
      blue: '#1c56b8',
      magenta: '#97359a',
      cyan: '#197b82',
      white: '#5c5b57',
      brightBlack: '#8a8983',
      brightRed: '#c53030',
      brightGreen: '#5c8f2a',
      brightYellow: '#b07d0a',
      brightBlue: '#2f6fd0',
      brightMagenta: '#ad46ab',
      brightCyan: '#1f8b93',
      brightWhite: '#2b2a27'
    }
  }
]

export const DEFAULT_THEME_ID = 'sand'

export function getTheme(id: string): TerminalThemePreset {
  return TERMINAL_THEMES.find((t) => t.id === id) ?? TERMINAL_THEMES[0]
}
