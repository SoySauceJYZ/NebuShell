import { useCallback, useEffect, useState } from 'react'
import { ArrowUp, FolderPlus, RefreshCw, HardDrive, Pencil, Trash2 } from 'lucide-react'
import { useSessionStore } from '../../store/useSessionStore'
import { useFileDnd } from '../../lib/useFileDnd'
import { localParent, localJoin } from '../../lib/pathUtils'
import { FileTable, type FileEntry, type MenuAction } from './FileTable'
import { usePromptModal } from './PromptModal'
import type { LocalListEntry } from '@shared/types'

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const TEXT_RE =
  /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|conf|cfg|env|log|csv|tsv|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bash|zsh|ps1|sql|dockerfile|gitignore|properties)$/i

export function LocalPane({
  initialCwd,
  onCwdChange
}: {
  initialCwd?: string
  onCwdChange?: (cwd: string) => void
}): React.ReactElement {
  const openTab = useSessionStore((s) => s.openTab)
  const [cwd, setCwd] = useState(initialCwd ?? '')
  const [editPath, setEditPath] = useState(initialCwd ?? '')
  const [entries, setEntries] = useState<LocalListEntry[]>([])
  const [drives, setDrives] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const { ask, node: promptNode } = usePromptModal()

  const load = useCallback(async (targetPath: string): Promise<boolean> => {
    try {
      const list = await window.api.local.list(targetPath)
      list.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'directory' ? -1 : 1
      })
      setEntries(list)
      setCwd(targetPath)
      setErrorMsg('')
      return true
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const submitPath = async (): Promise<void> => {
    const target = editPath.trim()
    if (!target) return
    const ok = await load(target)
    if (!ok) setEditPath(cwd)
  }

  // Resolve the starting directory (home) + available drives once.
  useEffect(() => {
    void window.api.local.drives().then(setDrives)
    if (initialCwd) {
      void load(initialCwd)
    } else {
      void window.api.local.home().then((home) => load(home))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (cwd) {
      setEditPath(cwd)
      onCwdChange?.(cwd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  const dnd = useFileDnd({ kind: 'local', dir: cwd, refresh: () => load(cwd) })

  const onOpen = (entry: FileEntry): void => {
    if (entry.type === 'directory') {
      load(entry.path)
      return
    }
    if (IMAGE_RE.test(entry.name)) {
      openTab({
        id: `image-${entry.path}`,
        kind: 'image',
        title: entry.name,
        imageLocalPath: entry.path,
        editorFileName: entry.name
      })
      return
    }
    if (TEXT_RE.test(entry.name)) {
      openTab({
        id: `editor-local-${entry.path}`,
        kind: 'editor',
        title: entry.name,
        editorLocalPath: entry.path,
        editorFileName: entry.name
      })
    }
  }

  const handleMkdir = async (): Promise<void> => {
    const name = await ask('新建文件夹', '新建文件夹')
    if (!name) return
    try {
      await window.api.local.mkdir(localJoin(cwd, name))
      await load(cwd)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const rename = async (entry: FileEntry): Promise<void> => {
    const name = await ask('重命名', entry.name)
    if (!name || name === entry.name) return
    await window.api.local.rename(entry.path, localJoin(cwd, name))
    await load(cwd)
  }

  const remove = async (entry: FileEntry): Promise<void> => {
    const ok = await window.api.dialog.confirm({
      message: `确定删除 “${entry.name}”?`,
      detail: entry.type === 'directory' ? '将递归删除整个目录。' : undefined,
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (!ok) return
    await window.api.local.remove(entry.path, entry.type === 'directory')
    await load(cwd)
  }

  const menuActions = (entry: FileEntry): MenuAction[] => {
    const list: MenuAction[] = []
    if (entry.type === 'file' && (IMAGE_RE.test(entry.name) || TEXT_RE.test(entry.name))) {
      list.push({ label: '打开预览', icon: Pencil, onSelect: onOpen })
    }
    list.push({ label: '重命名', icon: Pencil, onSelect: rename, separatorBefore: true })
    list.push({ label: '删除', icon: Trash2, onSelect: remove, danger: true })
    return list
  }

  return (
    <div className="relative flex h-full min-w-0 flex-col bg-[var(--panel-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-3 py-2">
        <button
          onClick={() => load(localParent(cwd))}
          className="rounded-lg px-2 py-1.5 text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
          title="上级目录"
        >
          <ArrowUp size={14} />
        </button>
        <button
          onClick={() => load(cwd)}
          className="rounded-lg px-2 py-1.5 text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
          title="刷新"
        >
          <RefreshCw size={14} />
        </button>
        {drives.length > 1 && (
          <div className="flex items-center gap-1">
            {drives.map((d) => (
              <button
                key={d}
                onClick={() => load(d)}
                title={d}
                className={`flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-xs hover:bg-[var(--nav-bg-hover)] ${
                  cwd.toUpperCase().startsWith(d.toUpperCase())
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--text-muted)]'
                }`}
              >
                <HardDrive size={13} />
                {d.replace(/\\$/, '')}
              </button>
            ))}
          </div>
        )}
        <input
          value={editPath}
          onChange={(e) => setEditPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitPath()
            else if (e.key === 'Escape') setEditPath(cwd)
          }}
          spellCheck={false}
          placeholder="…"
          title="输入路径后回车跳转"
          className="min-w-0 flex-1 rounded-lg bg-[var(--content-bg)] px-3 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <button onClick={handleMkdir} className="btn-secondary px-2.5 py-1.5" title="新建文件夹">
          <FolderPlus size={14} />
        </button>
      </div>

      {errorMsg && (
        <div className="border-b border-[var(--panel-border)] bg-red-50 px-3 py-1.5 text-xs text-red-600">
          {errorMsg}
        </div>
      )}

      <FileTable entries={entries} onOpen={onOpen} dnd={dnd} menuActions={menuActions} />
      {promptNode}
    </div>
  )
}
