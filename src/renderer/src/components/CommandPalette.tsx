import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, History, Zap, X, CornerDownLeft } from 'lucide-react'
import { useCommandHistoryStore, EMPTY_ENTRIES } from '../store/useCommandHistoryStore'
import { fetchServerHistory } from '../lib/serverHistory'
import { QUICK_ACTIONS } from '../lib/quickActions'
import type { CommandSource } from '@shared/types'

type PaletteTab = 'history' | 'actions'

const TABS: { id: PaletteTab; label: string; icon: typeof History }[] = [
  { id: 'history', label: '历史记录', icon: History },
  { id: 'actions', label: '快捷操作', icon: Zap }
]

type HistoryItemSource = CommandSource | 'server'

interface HistoryItem {
  command: string
  source: HistoryItemSource
}

const SOURCE_META: Record<HistoryItemSource, { label: string; className: string; title: string }> =
  {
    user: {
      label: 'User',
      title: '用户输入',
      className: 'bg-[var(--content-bg)] text-[var(--text-muted)]'
    },
    agent: {
      label: 'Agent',
      title: '由智能体执行',
      className: 'bg-[var(--accent-soft)] text-[var(--accent)]'
    },
    server: {
      label: 'Server',
      title: '来自服务器 ~/.bash_history',
      className: 'bg-[var(--nav-active-bg)] text-[var(--text-dark)]'
    }
  }

/**
 * The triple-Ctrl command palette. A tabbed overlay over the terminal:
 * - 历史记录: merged local (per-host, User/Agent) + server-side shell history.
 * - 快捷操作: the shared QUICK_ACTIONS list.
 * Tab / Shift+Tab cycle tabs, ↑/↓ move selection, Enter activates, Esc closes.
 * Selecting a history command fills it into the terminal input WITHOUT executing.
 */
export function CommandPalette({
  sessionId,
  hostId,
  connected,
  onFill,
  onClose
}: {
  sessionId: string
  hostId: string
  connected: boolean
  /** Write the command into the terminal input line (no newline) and close. */
  onFill: (command: string) => void
  onClose: () => void
}): React.ReactElement {
  const [tab, setTab] = useState<PaletteTab>('history')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [serverCommands, setServerCommands] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const localEntries = useCommandHistoryStore((s) => s.byHost[hostId] ?? EMPTY_ENTRIES)

  useEffect(() => {
    void useCommandHistoryStore.getState().hydrate(hostId)
  }, [hostId])

  // Fetch server-side history once on open (setState only after the await).
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    ;(async () => {
      try {
        const cmds = await fetchServerHistory(sessionId)
        if (!cancelled) setServerCommands(cmds)
      } catch {
        /* server history is best-effort; ignore failures */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, connected])

  // Merge local (most-recent-first) + server history, de-duped by command text.
  const historyItems = useMemo<HistoryItem[]>(() => {
    const items: HistoryItem[] = []
    const seen = new Set<string>()
    for (const e of [...localEntries].reverse()) {
      if (seen.has(e.command)) continue
      seen.add(e.command)
      items.push({ command: e.command, source: e.source })
    }
    for (const c of serverCommands) {
      if (seen.has(c)) continue
      seen.add(c)
      items.push({ command: c, source: 'server' })
    }
    return items
  }, [localEntries, serverCommands])

  const q = query.trim().toLowerCase()
  const filteredHistory = q
    ? historyItems.filter((it) => it.command.toLowerCase().includes(q))
    : historyItems
  const filteredActions = q
    ? QUICK_ACTIONS.filter(
        (a) => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
      )
    : QUICK_ACTIONS

  const count = tab === 'history' ? filteredHistory.length : filteredActions.length

  // Selection is reset at its event sources (tab / query change) rather than in an effect.
  const changeTab = (next: PaletteTab): void => {
    setTab(next)
    setSelected(0)
  }
  const changeQuery = (next: string): void => {
    setQuery(next)
    setSelected(0)
  }

  useEffect(() => inputRef.current?.focus(), [tab])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const activate = (index: number): void => {
    if (tab === 'history') {
      const it = filteredHistory[index]
      if (it) onFill(it.command)
    } else {
      const action = filteredActions[index]
      if (action) {
        action.run(sessionId)
        onClose()
      }
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const dir = e.shiftKey ? -1 : 1
      const i = TABS.findIndex((t) => t.id === tab)
      changeTab(TABS[(i + dir + TABS.length) % TABS.length].id)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => (count === 0 ? 0 : (s + 1) % count))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => (count === 0 ? 0 : (s - 1 + count) % count))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(selected)
    }
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[70vh] w-[min(680px,92%)] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[var(--panel-border)] p-1.5">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => changeTab(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'bg-[var(--nav-active-bg)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
          <div className="flex-1" />
          <span className="pr-1 text-[10px] text-[var(--text-muted)]">Tab 切换 · Esc 关闭</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <X size={15} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[var(--panel-border)] p-2">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--content-bg)] px-2.5 py-2">
            <Search size={15} className="text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder={tab === 'history' ? '搜索历史命令' : '搜索快捷操作'}
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>

        {/* List */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {tab === 'history' ? (
            filteredHistory.length === 0 ? (
              <Empty text={historyItems.length === 0 ? '暂无历史命令' : '没有匹配的命令'} />
            ) : (
              filteredHistory.map((it, i) => {
                const meta = SOURCE_META[it.source]
                return (
                  <div
                    key={`${it.command}-${i}`}
                    data-idx={i}
                    onMouseMove={() => setSelected(i)}
                    onClick={() => onFill(it.command)}
                    title="回车 / 点击填入终端输入行(不自动执行)"
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${
                      i === selected ? 'bg-[var(--nav-active-bg)]' : ''
                    }`}
                  >
                    <span
                      title={meta.title}
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-dark)]">
                      {it.command}
                    </span>
                    {i === selected && (
                      <CornerDownLeft size={13} className="shrink-0 text-[var(--text-muted)]" />
                    )}
                  </div>
                )
              })
            )
          ) : filteredActions.length === 0 ? (
            <Empty text="没有匹配的操作" />
          ) : (
            filteredActions.map((a, i) => {
              const Icon = a.icon
              return (
                <div
                  key={a.id}
                  data-idx={i}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => activate(i)}
                  className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${
                    !connected ? 'pointer-events-none opacity-50' : ''
                  } ${i === selected ? 'bg-[var(--nav-active-bg)]' : ''}`}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Icon size={16} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--text-dark)]">{a.label}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
                      {a.description}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }): React.ReactElement {
  return <div className="mt-10 text-center text-xs text-[var(--text-muted)]">{text}</div>
}
