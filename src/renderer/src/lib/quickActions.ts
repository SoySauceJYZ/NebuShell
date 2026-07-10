import { Languages, type LucideIcon } from 'lucide-react'

// Makes readline 8-bit clean and sets a UTF-8 locale so the shell accepts/echoes
// multibyte (Chinese) input even when the SSH session's LANG is unset or C/POSIX.
export const ENABLE_CJK_COMMAND =
  'export LANG=C.UTF-8 2>/dev/null; export LC_ALL=C.UTF-8 2>/dev/null; ' +
  "bind 'set input-meta on' 2>/dev/null; bind 'set output-meta on' 2>/dev/null; " +
  "bind 'set convert-meta off' 2>/dev/null; clear"

export interface QuickAction {
  id: string
  label: string
  description: string
  icon: LucideIcon
  /** Runs the action against the given terminal session. */
  run: (sessionId: string) => void
}

// Single source of truth for the "快捷操作" list, shared by the sidebar panel and the
// command palette. Add new actions here and both surfaces pick them up.
export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'enable-cjk',
    label: '启用中文输入',
    description:
      '让当前终端支持中文的输入与显示(设置 UTF-8 locale 并使 readline 8-bit 干净)。仅对当前会话生效。',
    icon: Languages,
    run: (sessionId) => window.api.ssh.write(sessionId, ENABLE_CJK_COMMAND + '\n')
  }
]
