import { useMemo, useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import {
  Folder,
  File as FileIcon,
  FileImage,
  ArrowUpRight,
  ChevronUp,
  ChevronDown
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
  label: string
  icon: typeof Folder
  onSelect: (entry: FileEntry) => void
  danger?: boolean
  separatorBefore?: boolean
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

export function FileTable({
  entries,
  onOpen,
  dnd,
  menuActions,
  dragOut
}: {
  entries: FileEntry[]
  onOpen: (entry: FileEntry) => void
  dnd: FileDnd
  menuActions: (entry: FileEntry) => MenuAction[]
  /** Return a native drag-out handler for this entry, or null if not draggable-out. */
  dragOut?: (entry: FileEntry) => (() => void) | null
}): React.ReactElement {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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

  return (
    <div
      className={`flex-1 overflow-y-auto transition-colors ${
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
            const actions = menuActions(entry)
            const isImage = entry.type === 'file' && IMAGE_RE.test(entry.name)
            const dragOutHandler = dragOut?.(entry) ?? null
            return (
              <ContextMenu.Root key={entry.path}>
                <ContextMenu.Trigger asChild>
                  <tr
                    {...dnd.getRowDragProps(entry)}
                    title={entry.type === 'directory' ? '双击进入目录' : '双击打开'}
                    className="group cursor-default border-t border-[var(--panel-border)] hover:bg-gray-50"
                    onDoubleClick={() => onOpen(entry)}
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
                    {actions.map((action, i) => (
                      <div key={action.label}>
                        {action.separatorBefore && i > 0 && (
                          <ContextMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
                        )}
                        <ContextMenu.Item
                          onSelect={() => action.onSelect(entry)}
                          className={`flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)] ${
                            action.danger ? 'text-[var(--danger)]' : 'text-[var(--text-dark)]'
                          }`}
                        >
                          <action.icon
                            size={15}
                            strokeWidth={1.75}
                            className={action.danger ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}
                          />
                          {action.label}
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
}
