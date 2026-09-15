import { useMemo, useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import {
  Folder,
  File as FileIcon,
  FileImage,
  ArrowUpRight,
  ChevronUp,
  ChevronDown,
  X
} from 'lucide-react'
import type { FileDnd } from '../../lib/useFileDnd'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifyTime: number
}

export interface MenuAction {
  /** 固定文案,或按选中项数生成(如「删除 3 项」)。 */
  label: string | ((count: number) => string)
  icon: typeof Folder
  /** 作用于**整个选区**;单选时数组里就一条。 */
  onSelect: (entries: FileEntry[]) => void
  /** 只对单个项目有意义(重命名、用编辑器打开…),多选时不显示。 */
  singleOnly?: boolean
  danger?: boolean
  separatorBefore?: boolean
}

/** Action shown when right-clicking empty space (no row under the cursor). */
export interface EmptyMenuAction {
  label: string
  icon: typeof Folder
  onSelect: () => void
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

type SortKey = 'name' | 'size' | 'modifyTime'
type SortDir = 'asc' | 'desc'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const labelOf = (action: MenuAction, count: number): string =>
  typeof action.label === 'function' ? action.label(count) : action.label

export function FileTable({
  entries,
  onOpen,
  dnd,
  menuActions,
  dragOut,
  emptyMenuActions
}: {
  entries: FileEntry[]
  onOpen: (entry: FileEntry) => void
  dnd: FileDnd
  /** 传入的是当前选区(单选时一条);据此决定菜单项与文案。 */
  menuActions: (entries: FileEntry[]) => MenuAction[]
  /** Return a native drag-out handler for this entry, or null if not draggable-out. */
  dragOut?: (entry: FileEntry) => (() => void) | null
  /** Actions offered when right-clicking blank space in the list. */
  emptyMenuActions?: EmptyMenuAction[]
}): React.ReactElement {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  // 选中项按路径记录。目录一换,这些路径自然都不在新列表里,下面的派生集合即为空。
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  /** Shift 连选的锚点(路径)。 */
  const [anchor, setAnchor] = useState<string | null>(null)

  const toggleSort = (key: SortKey): void => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Folders are always grouped on top; the chosen column sorts within each group.
  const sorted = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1
    return [...entries].sort((a, b) => {
      const aDir = a.type === 'directory'
      const bDir = b.type === 'directory'
      if (aDir !== bDir) return aDir ? -1 : 1
      let cmp: number
      if (sortKey === 'size') cmp = a.size - b.size
      else if (sortKey === 'modifyTime') cmp = a.modifyTime - b.modifyTime
      else cmp = a.name.localeCompare(b.name)
      if (cmp === 0) cmp = a.name.localeCompare(b.name)
      return cmp * dirMul
    })
  }, [entries, sortKey, sortDir])

  // 只保留仍然存在的路径:刷新掉了的文件、切走的目录都会自动从选区里消失,
  // 不需要用 effect 去同步(那样反而会多渲染一轮)。
  const selected = useMemo(() => {
    if (selectedPaths.size === 0) return new Set<string>()
    const alive = new Set<string>()
    for (const e of sorted) if (selectedPaths.has(e.path)) alive.add(e.path)
    return alive
  }, [selectedPaths, sorted])

  const selectedEntries = useMemo(
    () => sorted.filter((e) => selected.has(e.path)),
    [sorted, selected]
  )

  const selectOnly = (entry: FileEntry): void => {
    setSelectedPaths(new Set([entry.path]))
    setAnchor(entry.path)
  }

  const toggleOne = (entry: FileEntry): void => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
    setAnchor(entry.path)
  }

  /** 从锚点到当前行(按当前排序后的可见顺序)整段选中。 */
  const selectRange = (entry: FileEntry): void => {
    const to = sorted.findIndex((e) => e.path === entry.path)
    const from = anchor ? sorted.findIndex((e) => e.path === anchor) : -1
    if (to < 0 || from < 0) {
      selectOnly(entry)
      return
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    setSelectedPaths(new Set(sorted.slice(lo, hi + 1).map((e) => e.path)))
  }

  const clearSelection = (): void => {
    setSelectedPaths(new Set())
    setAnchor(null)
  }

  const onRowMouseDown = (e: React.MouseEvent, entry: FileEntry): void => {
    if (e.button === 2) {
      // 右键:落在选区外就先把它选中,落在选区内则保留整个选区(菜单作用于全部)。
      if (!selected.has(entry.path)) selectOnly(entry)
      return
    }
    if (e.button !== 0) return
    if (e.shiftKey) selectRange(entry)
    else if (e.ctrlKey || e.metaKey) toggleOne(entry)
    else if (!selected.has(entry.path)) selectOnly(entry)
    // 已在多选里的行:按下时不动选区,这样还能整体右键;真正的「收敛成一条」放到 click,
    // 拖拽不会触发 click,于是拖动也不会破坏选区。
  }

  const onRowClick = (e: React.MouseEvent, entry: FileEntry): void => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) return
    if (selected.size > 1 && selected.has(entry.path)) selectOnly(entry)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelectedPaths(new Set(sorted.map((x) => x.path)))
      return
    }
    if (e.key === 'Escape') {
      clearSelection()
      return
    }
    if (e.key === 'Delete' && selectedEntries.length > 0) {
      // 删除键走菜单里那条危险动作(各面板自己带确认框)。
      const del = menuActions(selectedEntries).find((a) => a.danger)
      if (del) {
        e.preventDefault()
        del.onSelect(selectedEntries)
      }
    }
  }

  const SortHeader = ({
    label,
    col,
    className
  }: {
    label: string
    col: SortKey
    className?: string
  }): React.ReactElement => (
    <th className={`px-4 py-2 font-medium ${className ?? ''}`}>
      <button
        onClick={() => toggleSort(col)}
        className="flex items-center gap-1 hover:text-[var(--text-dark)]"
      >
        {label}
        {sortKey === col &&
          (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
    </th>
  )

  const list = (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      // 点空白处清空选区(点在行上时由行自己处理,不会冒到这里生效)。
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'TABLE') {
          clearSelection()
        }
      }}
      className={`flex-1 overflow-y-auto outline-none transition-colors ${
        dnd.isDragOver ? 'bg-[var(--accent)]/5 ring-2 ring-inset ring-[var(--accent)]' : ''
      }`}
      {...dnd.dropZoneProps}
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs text-[var(--text-muted)]">
          <tr>
            <SortHeader label="名称" col="name" />
            <SortHeader label="大小" col="size" />
            <SortHeader label="修改时间" col="modifyTime" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => {
            const isSelected = selected.has(entry.path)
            // 右键落在选区内 → 菜单作用于整个选区;否则只作用于这一条。
            const targets = isSelected && selectedEntries.length > 0 ? selectedEntries : [entry]
            const actions = menuActions(targets).filter(
              (a) => !(a.singleOnly && targets.length > 1)
            )
            const isImage = entry.type === 'file' && IMAGE_RE.test(entry.name)
            const dragOutHandler = dragOut?.(entry) ?? null
            return (
              <ContextMenu.Root key={entry.path}>
                <ContextMenu.Trigger asChild>
                  <tr
                    {...dnd.getRowDragProps(entry)}
                    title={entry.type === 'directory' ? '双击进入目录' : '双击打开'}
                    className={`group cursor-default border-t border-[var(--panel-border)] ${
                      isSelected ? 'bg-[var(--accent-soft)]' : 'hover:bg-gray-50'
                    }`}
                    onMouseDown={(e) => onRowMouseDown(e, entry)}
                    onClick={(e) => onRowClick(e, entry)}
                    onDoubleClick={() => onOpen(entry)}
                    onContextMenu={(e) => e.stopPropagation()}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {entry.type === 'directory' ? (
                          <Folder size={14} className="shrink-0 text-[var(--accent)]" />
                        ) : isImage ? (
                          <FileImage size={14} className="shrink-0 text-[var(--text-muted)]" />
                        ) : (
                          <FileIcon size={14} className="shrink-0 text-[var(--text-muted)]" />
                        )}
                        <span className="truncate">{entry.name}</span>
                        {dragOutHandler && (
                          <span
                            draggable
                            onDragStart={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              dragOutHandler()
                            }}
                            title="拖到桌面/资源管理器"
                            className="ml-auto cursor-grab opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                          >
                            <ArrowUpRight size={13} className="text-[var(--text-muted)]" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-[var(--text-muted)]">
                      {entry.type === 'directory' ? '-' : formatSize(entry.size)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-[var(--text-muted)]">
                      {entry.modifyTime ? new Date(entry.modifyTime).toLocaleString() : '-'}
                    </td>
                  </tr>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className="z-[70] min-w-[180px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
                    {targets.length > 1 && (
                      <div className="px-2.5 py-1 text-[11px] text-[var(--text-muted)]">
                        已选 {targets.length} 项
                      </div>
                    )}
                    {actions.map((action, i) => (
                      <div key={labelOf(action, targets.length)}>
                        {action.separatorBefore && i > 0 && (
                          <ContextMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
                        )}
                        <ContextMenu.Item
                          onSelect={() => action.onSelect(targets)}
                          className={`flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)] ${
                            action.danger ? 'text-[var(--danger)]' : 'text-[var(--text-dark)]'
                          }`}
                        >
                          <action.icon
                            size={15}
                            strokeWidth={1.75}
                            className={
                              action.danger ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'
                            }
                          />
                          {labelOf(action, targets.length)}
                        </ContextMenu.Item>
                      </div>
                    ))}
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            )
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
                空目录
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  const withEmptyMenu =
    !emptyMenuActions || emptyMenuActions.length === 0 ? (
      list
    ) : (
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{list}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="z-[70] min-w-[180px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
            {emptyMenuActions.map((action) => (
              <ContextMenu.Item
                key={action.label}
                onSelect={() => action.onSelect()}
                className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
              >
                <action.icon size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                {action.label}
              </ContextMenu.Item>
            ))}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {withEmptyMenu}
      {selected.size > 1 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
          <span>已选 {selected.size} 项</span>
          <span className="truncate">· 右键可对全部选中项操作</span>
          <div className="flex-1" />
          <button
            onClick={clearSelection}
            title="取消选择"
            className="rounded p-0.5 hover:bg-[var(--nav-bg-hover)]"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
