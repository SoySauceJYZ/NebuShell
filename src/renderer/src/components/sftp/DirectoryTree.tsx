import { useCallback, useEffect, useRef, useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from 'lucide-react'

/** Backend-agnostic operations the tree needs. One adapter per pane kind. */
export interface TreeAdapter {
  rootPath: string
  rootLabel: string
  listDir: (path: string) => Promise<{ name: string; path: string; type: string }[]>
  parentOf: (path: string) => string
  join: (dir: string, name: string) => string
  // Providing these enables the right-click menu; omit for a read-only tree.
  mkdir?: (path: string) => Promise<void>
  rename?: (oldPath: string, newPath: string) => Promise<void>
  removeDir?: (path: string) => Promise<void>
}

interface DirChild {
  name: string
  path: string
}
type NodeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; dirs: DirChild[] }

/**
 * A lazy-loaded directory tree. Only directories are shown; expanding a node lists
 * its children on demand. Selecting a node reports the path to the parent (which owns
 * navigation). Backend differences are hidden behind {@link TreeAdapter}.
 */
export function DirectoryTree({
  adapter,
  selectedPath,
  onSelect,
  onChanged,
  refreshToken = 0,
  ask
}: {
  adapter: TreeAdapter
  selectedPath: string
  onSelect: (path: string) => void
  /** Called after a tree-initiated mkdir/rename/delete so the parent can refresh its list. */
  onChanged?: () => void
  /** Bump to invalidate cached children of the currently-expanded dirs. */
  refreshToken?: number
  ask: (title: string, defaultValue?: string) => Promise<string | null>
}): React.ReactElement {
  const [cache, setCache] = useState<Record<string, NodeState>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([adapter.rootPath]))
  const cacheRef = useRef(cache)
  cacheRef.current = cache
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const loadDir = useCallback(
    async (path: string): Promise<void> => {
      setCache((c) => ({ ...c, [path]: { status: 'loading' } }))
      try {
        const list = await adapter.listDir(path)
        const dirs = list
          .filter((e) => e.type === 'directory')
          .map((e) => ({ name: e.name, path: e.path }))
          .sort((a, b) => a.name.localeCompare(b.name))
        setCache((c) => ({ ...c, [path]: { status: 'loaded', dirs } }))
      } catch (err) {
        setCache((c) => ({
          ...c,
          [path]: { status: 'error', message: err instanceof Error ? err.message : String(err) }
        }))
      }
    },
    [adapter]
  )

  // Load the root once on mount / when the root changes (e.g. local drive switch).
  useEffect(() => {
    setExpanded(new Set([adapter.rootPath]))
    void loadDir(adapter.rootPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter.rootPath])

  // Follow the current directory: expand its ancestor chain and highlight it.
  useEffect(() => {
    if (!selectedPath) return
    const chain: string[] = [adapter.rootPath]
    let p = selectedPath
    let guard = 0
    while (p && p !== adapter.rootPath && guard++ < 64) {
      const parent = adapter.parentOf(p)
      if (parent === p) break
      if (parent !== selectedPath) chain.push(parent)
      p = parent
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const a of chain) next.add(a)
      return next
    })
    for (const a of chain) if (!cacheRef.current[a]) void loadDir(a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, adapter])

  // External fs change: refetch whatever is currently expanded so the tree stays truthful.
  useEffect(() => {
    if (refreshToken === 0) return
    for (const path of expandedRef.current) void loadDir(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  const toggle = (path: string): void => {
    if (expanded.has(path)) {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    } else {
      setExpanded((prev) => new Set(prev).add(path))
      if (!cache[path]) void loadDir(path)
    }
  }

  const selectNode = (path: string): void => {
    onSelect(path)
    if (!expanded.has(path)) {
      setExpanded((prev) => new Set(prev).add(path))
      if (!cache[path]) void loadDir(path)
    }
  }

  // --- right-click actions ---
  const newFolder = async (dirPath: string): Promise<void> => {
    if (!adapter.mkdir) return
    const name = await ask('新建文件夹', '新建文件夹')
    if (!name) return
    await adapter.mkdir(adapter.join(dirPath, name))
    setExpanded((prev) => new Set(prev).add(dirPath))
    await loadDir(dirPath)
    onChanged?.()
  }
  const renameNode = async (node: DirChild): Promise<void> => {
    if (!adapter.rename) return
    const name = await ask('重命名', node.name)
    if (!name || name === node.name) return
    const parent = adapter.parentOf(node.path)
    await adapter.rename(node.path, adapter.join(parent, name))
    await loadDir(parent)
    onChanged?.()
  }
  const deleteNode = async (node: DirChild): Promise<void> => {
    if (!adapter.removeDir) return
    const ok = await window.api.dialog.confirm({
      message: `确定删除文件夹 “${node.name}”?`,
      detail: '目录及其内容将被删除。',
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (!ok) return
    const parent = adapter.parentOf(node.path)
    await adapter.removeDir(node.path)
    await loadDir(parent)
    onChanged?.()
  }

  const hasMenu = !!(adapter.mkdir || adapter.rename || adapter.removeDir)

  const renderNode = (node: DirChild, depth: number): React.ReactElement => {
    const isOpen = expanded.has(node.path)
    const isSelected = node.path === selectedPath
    const state = cache[node.path]
    const row = (
      <div
        onClick={() => selectNode(node.path)}
        title={node.path}
        className={`flex cursor-pointer select-none items-center gap-1 py-1 pr-2 text-xs ${
          isSelected
            ? 'bg-[var(--nav-active-bg)] text-[var(--accent)]'
            : 'text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]'
        }`}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggle(node.path)
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--panel-border)]"
        >
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {isOpen ? (
          <FolderOpen size={14} className="shrink-0 text-[var(--accent)]" />
        ) : (
          <Folder size={14} className="shrink-0 text-[var(--accent)]" />
        )}
        <span className="truncate">{node.name}</span>
      </div>
    )
    return (
      <div key={node.path}>
        {hasMenu ? (
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="z-[80] min-w-[160px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
                {adapter.mkdir && (
                  <MenuItem icon={FolderPlus} label="新建文件夹" onSelect={() => void newFolder(node.path)} />
                )}
                {adapter.rename && (
                  <MenuItem icon={Pencil} label="重命名" onSelect={() => void renameNode(node)} />
                )}
                {adapter.removeDir && (
                  <MenuItem icon={Trash2} label="删除" danger onSelect={() => void deleteNode(node)} />
                )}
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        ) : (
          row
        )}
        {isOpen && (
          <div>
            {state?.status === 'loading' && (
              <div className="py-1 text-[11px] text-[var(--text-muted)]" style={{ paddingLeft: 24 + depth * 12 }}>
                加载中…
              </div>
            )}
            {state?.status === 'error' && (
              <div className="py-1 text-[11px] text-red-500" style={{ paddingLeft: 24 + depth * 12 }}>
                {state.message}
              </div>
            )}
            {state?.status === 'loaded' &&
              (state.dirs.length === 0 ? (
                <div
                  className="py-1 text-[11px] text-[var(--text-muted)]"
                  style={{ paddingLeft: 24 + depth * 12 }}
                >
                  (无子目录)
                </div>
              ) : (
                state.dirs.map((child) => renderNode(child, depth + 1))
              ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="py-1">{renderNode({ name: adapter.rootLabel, path: adapter.rootPath }, 0)}</div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
  danger
}: {
  icon: typeof Folder
  label: string
  onSelect: () => void
  danger?: boolean
}): React.ReactElement {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      className={`flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)] ${
        danger ? 'text-[var(--danger)]' : 'text-[var(--text-dark)]'
      }`}
    >
      <Icon size={15} strokeWidth={1.75} className={danger ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'} />
      {label}
    </ContextMenu.Item>
  )
}
