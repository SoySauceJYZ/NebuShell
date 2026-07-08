import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUp,
  Upload,
  FolderPlus,
  RefreshCw,
  Maximize2,
  Download,
  FilePenLine,
  Pencil,
  Trash2
} from 'lucide-react'
import { useVaultStore } from '../../store/useVaultStore'
import { useSessionStore } from '../../store/useSessionStore'
import { useTransfersStore } from '../../store/useTransfersStore'
import { resolveConnectOptions } from '../../lib/resolveConnectOptions'
import { useFileDnd } from '../../lib/useFileDnd'
import { remoteParent } from '../../lib/pathUtils'
import { FileTable, type FileEntry, type MenuAction } from './FileTable'
import { usePromptModal } from './PromptModal'
import type { SftpListEntry } from '@shared/types'

function remoteJoin(dir: string, name: string): string {
  const d = dir.replace(/\/+$/, '')
  return d === '' ? `/${name}` : `${d}/${name}`
}

function genId(): string {
  return crypto?.randomUUID ? crypto.randomUUID() : `t-${Date.now()}-${Math.random()}`
}

export function RemotePane({
  sessionId,
  hostId,
  embedded,
  onExpand
}: {
  sessionId: string
  hostId: string
  embedded?: boolean
  onExpand?: () => void
}): React.ReactElement {
  const hosts = useVaultStore((s) => s.hosts)
  const credentials = useVaultStore((s) => s.credentials)
  const openTab = useSessionStore((s) => s.openTab)
  const track = useTransfersStore((s) => s.track)
  const [path, setPath] = useState('/')
  const [editPath, setEditPath] = useState('/')
  const [entries, setEntries] = useState<SftpListEntry[]>([])
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [navError, setNavError] = useState('')
  const { ask, node: promptNode } = usePromptModal()

  // list a directory; returns false (and keeps the current view) on failure so a
  // bad manual path doesn't tear down the whole pane.
  const load = useCallback(
    async (targetPath: string): Promise<boolean> => {
      try {
        const list = await window.api.sftp.list(sessionId, targetPath)
        list.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name)
          return a.type === 'directory' ? -1 : 1
        })
        setEntries(list)
        setPath(targetPath)
        setNavError('')
        return true
      } catch (err) {
        setNavError(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [sessionId]
  )

  // Keep the editable address bar in sync with the current directory.
  useEffect(() => {
    setEditPath(path)
  }, [path])

  const submitPath = async (): Promise<void> => {
    const target = editPath.trim() || '/'
    const ok = await load(target)
    if (!ok) setEditPath(path)
  }

  useEffect(() => {
    const host = hosts.find((h) => h.id === hostId)
    if (!host) return
    const opts = resolveConnectOptions(sessionId, host, credentials)
    window.api.sftp
      .connect(opts)
      .then(() => {
        setStatus('ready')
        return load('/')
      })
      .catch((err) => {
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
    return () => {
      window.api.sftp.disconnect(sessionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hostId])

  const dnd = useFileDnd({
    kind: 'remote',
    sessionId,
    hostId,
    dir: path,
    refresh: () => load(path)
  })

  const onOpen = (entry: FileEntry): void => {
    if (entry.type === 'directory') {
      load(entry.path)
      return
    }
    openTab({
      id: `editor-sftp-${sessionId}-${entry.path}`,
      kind: 'editor',
      title: entry.name,
      editorSftpSessionId: sessionId,
      editorRemotePath: entry.path,
      editorFileKey: `${hostId}:${entry.path}`,
      editorFileName: entry.name
    })
  }

  const handleUpload = async (): Promise<void> => {
    const uploaded = await window.api.sftp.upload(sessionId, path)
    if (uploaded) await load(path)
  }

  const handleMkdir = async (): Promise<void> => {
    const name = await ask('新建文件夹', '新建文件夹')
    if (!name) return
    try {
      await window.api.sftp.mkdir(sessionId, remoteJoin(path, name))
      await load(path)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const downloadTo = async (entry: FileEntry): Promise<void> => {
    const dir = await window.api.local.pickDir()
    if (!dir) return
    const transferId = genId()
    track(transferId, `下载 ${entry.name}`)
    try {
      await window.api.sftp.downloadTo(sessionId, entry.path, dir, transferId)
    } catch {
      // surfaced via transfers overlay
    }
  }

  const rename = async (entry: FileEntry): Promise<void> => {
    const name = await ask('重命名', entry.name)
    if (!name || name === entry.name) return
    await window.api.sftp.rename(sessionId, entry.path, remoteJoin(path, name))
    await load(path)
  }

  const remove = async (entry: FileEntry): Promise<void> => {
    const ok = await window.api.dialog.confirm({
      message: `确定删除 “${entry.name}”?`,
      detail: entry.type === 'directory' ? '目录必须为空才能删除。' : undefined,
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (!ok) return
    await window.api.sftp.remove(sessionId, entry.path, entry.type === 'directory')
    await load(path)
  }

  const menuActions = (entry: FileEntry): MenuAction[] => {
    const list: MenuAction[] = []
    if (entry.type !== 'directory') {
      list.push({ label: '用编辑器打开', icon: FilePenLine, onSelect: onOpen })
    }
    list.push({ label: '下载到…', icon: Download, onSelect: downloadTo })
    list.push({ label: '重命名', icon: Pencil, onSelect: rename, separatorBefore: true })
    list.push({ label: '删除', icon: Trash2, onSelect: remove, danger: true })
    return list
  }

  const dragOut = (entry: FileEntry): (() => void) | null =>
    entry.type === 'directory'
      ? null
      : () => window.api.sftp.startDrag(sessionId, entry.path, entry.name)

  if (status === 'connecting') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
        正在连接 SFTP...
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-red-500">
        SFTP 连接失败: {errorMsg}
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-w-0 flex-col bg-[var(--panel-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-3 py-2">
        <button
          onClick={() => load(remoteParent(path))}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
          title="上级目录"
        >
          <ArrowUp size={14} />
        </button>
        <button
          onClick={() => load(path)}
          className="rounded-lg px-2 py-1.5 text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
          title="刷新"
        >
          <RefreshCw size={14} />
        </button>
        <input
          value={editPath}
          onChange={(e) => setEditPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitPath()
            else if (e.key === 'Escape') setEditPath(path)
          }}
          spellCheck={false}
          title="输入路径后回车跳转"
          className="min-w-0 flex-1 rounded-lg bg-[var(--content-bg)] px-3 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <button onClick={handleMkdir} className="btn-secondary px-2.5 py-1.5" title="新建文件夹">
          <FolderPlus size={14} />
        </button>
        <button onClick={handleUpload} className="btn-secondary px-2.5 py-1.5" title="上传文件">
          <Upload size={14} />
        </button>
        {embedded && onExpand && (
          <button onClick={onExpand} className="btn-primary px-2.5 py-1.5" title="展开为整页 SFTP">
            <Maximize2 size={14} />
          </button>
        )}
      </div>

      {navError && (
        <div className="border-b border-[var(--panel-border)] bg-red-50 px-3 py-1.5 text-xs text-red-600">
          {navError}
        </div>
      )}

      <FileTable
        entries={entries}
        onOpen={onOpen}
        dnd={dnd}
        menuActions={menuActions}
        dragOut={dragOut}
      />
      {promptNode}
    </div>
  )
}
