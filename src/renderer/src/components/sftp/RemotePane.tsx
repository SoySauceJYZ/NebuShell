import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUp,
  Upload,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Maximize2,
  Download,
  FilePenLine,
  Pencil,
  Trash2,
  PanelLeft,
  SquareTerminal,
  Terminal,
  FolderInput
} from 'lucide-react'
import { useVaultStore } from '../../store/useVaultStore'
import { useSessionStore } from '../../store/useSessionStore'
import { useTransfersStore } from '../../store/useTransfersStore'
import { resolveConnectOptions } from '../../lib/resolveConnectOptions'
import { useFileDnd } from '../../lib/useFileDnd'
import { consumeDetaching } from '../../lib/detachRegistry'
import { recallDir, registerPane, rememberDir, unregisterPane } from '../../lib/dirMemory'
import { remoteParent, remoteJoin, shellQuotePath } from '../../lib/pathUtils'
import { confirmDelete } from '../../lib/confirmDelete'
import { FileTable, type FileEntry, type MenuAction, type EmptyMenuAction } from './FileTable'
import { DirectoryTree, type TreeAdapter } from './DirectoryTree'
import { usePromptModal } from './PromptModal'
import type { SftpListEntry } from '@shared/types'

function genId(): string {
  return crypto?.randomUUID ? crypto.randomUUID() : `t-${Date.now()}-${Math.random()}`
}

/** Last path segment, tolerating both local ('\\') and posix ('/') separators. */
function baseName(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

export function RemotePane({
  sessionId,
  hostId,
  ownerId,
  initialPath,
  embedded,
  onExpand,
  terminalSessionId
}: {
  sessionId: string
  hostId: string
  /** 首次打开时定位到的目录(本会话已有浏览记录时以记录为准)。 */
  initialPath?: string
  /** Tab/window that owns transfers started here (scopes the records panel). */
  ownerId: string
  embedded?: boolean
  onExpand?: () => void
  /**
   * 该面板贴着的终端会话。有值时右键菜单多一条「输入路径到终端」;整页 SFTP
   * 标签页没有配套终端,不传即可,菜单里也就不会出现这条。
   */
  terminalSessionId?: string
}): React.ReactElement {
  const hosts = useVaultStore((s) => s.hosts)
  const credentials = useVaultStore((s) => s.credentials)
  const openTab = useSessionStore((s) => s.openTab)
  const track = useTransfersStore((s) => s.track)
  // 面板重开时直接从上次的目录起步,地址栏不会先闪一下 '/'。
  const [path, setPath] = useState(() => recallDir(sessionId) ?? initialPath ?? '/')
  const [editPath, setEditPath] = useState(path)
  const [entries, setEntries] = useState<SftpListEntry[]>([])
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [navError, setNavError] = useState('')
  const [showTree, setShowTree] = useState(!embedded)
  /** 正在探测终端当前目录(按钮禁用 + 图标呼吸)。 */
  const [following, setFollowing] = useState(false)
  // Bumped after any fs mutation so the tree can invalidate its cached children.
  const [fsVersion, setFsVersion] = useState(0)
  const bumpFs = (): void => setFsVersion((v) => v + 1)
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
        rememberDir(sessionId, targetPath)
        registerPane(sessionId, { ownerId, hostId, path: targetPath })
        setNavError('')
        return true
      } catch (err) {
        setNavError(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [sessionId, hostId, ownerId]
  )

  // Keep the editable address bar in sync with the current directory.
  useEffect(() => {
    setEditPath(path)
  }, [path])

  // 让别的文件浏览器能在「添加面板」里看到这个面板(卸载即消失)。
  useEffect(() => {
    registerPane(sessionId, {
      ownerId,
      hostId,
      path: recallDir(sessionId) ?? initialPath ?? '/'
    })
    return () => unregisterPane(sessionId)
  }, [sessionId, hostId, ownerId, initialPath])

  const submitPath = async (): Promise<void> => {
    const target = editPath.trim() || '/'
    const ok = await load(target)
    if (!ok) setEditPath(path)
  }

  useEffect(() => {
    const host = hosts.find((h) => h.id === hostId)
    if (!host) return
    // Adopted from another window: the sftp session is already alive in main — reuse it
    // (skip connect, just list) instead of reconnecting.
    const adopted =
      useSessionStore.getState().tabs.find((t) => t.id === sessionId)?.adopted === true
    if (adopted) useSessionStore.getState().clearAdopted(sessionId)
    const ready = adopted
      ? Promise.resolve()
      : window.api.sftp.connect(resolveConnectOptions(sessionId, host, credentials))
    // 首次打开(本会话还没有浏览记录)且贴在终端旁边时,起始目录跟随终端命令行此刻
    // 所在的目录,而不是从 '/' 开始。探测与 SFTP 连接并行,不额外拖慢面板打开;探不到
    // (非 Linux、权限不足、超时)就返回 null,落回原来的默认目录。
    const probeCwd =
      recallDir(sessionId) || initialPath || !terminalSessionId
        ? Promise.resolve(null)
        : window.api.ssh.cwd(terminalSessionId).catch(() => null)
    ready
      .then(async () => {
        setStatus('ready')
        // 目录可能已被删除/权限变化,列不出来就退回根目录。
        const start = recallDir(sessionId) ?? initialPath ?? (await probeCwd)
        if (start && start !== '/' && (await load(start))) return
        await load('/')
      })
      .catch((err) => {
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
    return () => {
      // Keep the session alive if this pane is being torn off to another window.
      if (!consumeDetaching(sessionId)) window.api.sftp.disconnect(sessionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hostId])

  const dnd = useFileDnd({
    kind: 'remote',
    sessionId,
    hostId,
    ownerId,
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
    const files = await window.api.local.pickFiles()
    if (files.length === 0) return
    const transferId = genId()
    const label = files.length === 1 ? `上传 ${baseName(files[0])}` : `上传 ${files.length} 个文件`
    track(transferId, label, ownerId)
    try {
      await window.api.sftp.uploadPaths(sessionId, path, files, transferId)
    } catch {
      // surfaced via transfers overlay
    }
    await load(path)
  }

  const handleMkdir = async (): Promise<void> => {
    const name = await ask('新建文件夹', '新建文件夹')
    if (!name) return
    if (entries.some((e) => e.name === name)) {
      setNavError(`“${name}” 已存在`)
      return
    }
    try {
      await window.api.sftp.mkdir(sessionId, remoteJoin(path, name))
      await load(path)
      bumpFs()
    } catch (err) {
      setNavError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreateFile = async (): Promise<void> => {
    const name = await ask('新建文件', 'untitled.txt')
    if (!name) return
    if (entries.some((e) => e.name === name)) {
      setNavError(`“${name}” 已存在`)
      return
    }
    try {
      await window.api.sftp.writeFile(sessionId, remoteJoin(path, name), '')
      await load(path)
    } catch (err) {
      setNavError(err instanceof Error ? err.message : String(err))
    }
  }

  const emptyMenuActions: EmptyMenuAction[] = [
    { label: '新建文件', icon: FilePlus, onSelect: handleCreateFile },
    { label: '新建文件夹', icon: FolderPlus, onSelect: handleMkdir }
  ]

  const downloadTo = async (targets: FileEntry[]): Promise<void> => {
    const dir = await window.api.local.pickDir()
    if (!dir) return
    // 多选时按顺序逐条下载,每条在传输面板里各占一行(与拖放下载一致)。
    for (const entry of targets) {
      const transferId = genId()
      track(transferId, `下载 ${entry.name}`, ownerId)
      try {
        await window.api.sftp.downloadTo(sessionId, entry.path, dir, transferId)
      } catch {
        // surfaced via transfers overlay
      }
    }
  }

  const rename = async (entry: FileEntry): Promise<void> => {
    const name = await ask('重命名', entry.name)
    if (!name || name === entry.name) return
    await window.api.sftp.rename(sessionId, entry.path, remoteJoin(path, name))
    await load(path)
    bumpFs()
  }

  /** 删除选中的一批(目录递归删除)。 */
  const remove = async (targets: FileEntry[]): Promise<void> => {
    if (!(await confirmDelete(targets))) return
    try {
      await window.api.sftp.removePaths(
        sessionId,
        targets.map((t) => t.path)
      )
      setNavError('')
    } catch (err) {
      setNavError(err instanceof Error ? err.message : String(err))
    }
    await load(path)
    bumpFs()
  }

  // 把整条路径填进终端的当前输入行(不回车),用户可以在前面补命令再执行。
  // 走和「历史命令」面板一样的写入方式,含空格等特殊字符的路径会自动加引号。
  // 多选时一次填入多条(空格分隔),正好可以接在 tar / cp 之类命令后面。
  const insertIntoTerminal = (targets: FileEntry[]): void => {
    if (!terminalSessionId) return
    // 末尾留个空格,和终端里拖放文件的习惯一致,方便接着拼下一个参数。
    const text = targets.map((t) => shellQuotePath(t.path)).join(' ') + ' '
    window.api.ssh.write(terminalSessionId, text)
  }

  // 让旁边的终端 cd 到某个目录(选中的是文件就去它所在的目录),直接回车执行。
  const openInTerminal = (dir: string): void => {
    if (!terminalSessionId) return
    window.api.ssh.write(terminalSessionId, `cd ${shellQuotePath(dir)}\n`)
  }

  /**
   * 反方向:把面板跳到终端此刻所在的目录。复用打开面板时那套 /proc 反查 ——
   * 不往 shell 里写任何东西,终端里看不到痕迹;探不到(非 Linux、权限不足、超时)
   * 就如实说一声,而不是默默什么都不做。
   */
  const followTerminal = async (): Promise<void> => {
    if (!terminalSessionId || following) return
    setFollowing(true)
    try {
      const dir = await window.api.ssh.cwd(terminalSessionId)
      if (!dir) {
        setNavError(
          '读不到终端当前目录(需要 Linux 的 /proc;若终端正卡在某个前台程序里,先回到提示符再试)'
        )
        return
      }
      if (dir === path) {
        setNavError('')
        return
      }
      await load(dir)
    } finally {
      setFollowing(false)
    }
  }

  const menuActions = (targets: FileEntry[]): MenuAction[] => {
    const one = targets[0]
    const list: MenuAction[] = []
    if (one && one.type !== 'directory') {
      list.push({
        label: '用编辑器打开',
        icon: FilePenLine,
        singleOnly: true,
        onSelect: (t) => onOpen(t[0])
      })
    }
    list.push({
      label: (n) => (n > 1 ? `下载 ${n} 项到…` : '下载到…'),
      icon: Download,
      onSelect: (t) => void downloadTo(t)
    })
    if (terminalSessionId) {
      list.push({
        label: '在终端中打开',
        icon: Terminal,
        singleOnly: true,
        onSelect: (t) =>
          openInTerminal(t[0].type === 'directory' ? t[0].path : remoteParent(t[0].path))
      })
      list.push({
        label: (n) => (n > 1 ? `输入 ${n} 条路径到终端` : '输入路径到终端'),
        icon: SquareTerminal,
        onSelect: insertIntoTerminal
      })
    }
    list.push({
      label: '重命名',
      icon: Pencil,
      singleOnly: true,
      onSelect: (t) => void rename(t[0]),
      separatorBefore: true
    })
    list.push({
      label: (n) => (n > 1 ? `删除 ${n} 项` : '删除'),
      icon: Trash2,
      onSelect: (t) => void remove(t),
      danger: true
    })
    return list
  }

  const dragOut = (entry: FileEntry): (() => void) | null =>
    entry.type === 'directory'
      ? null
      : () => window.api.sftp.startDrag(sessionId, entry.path, entry.name)

  const treeAdapter = useMemo<TreeAdapter>(
    () => ({
      rootPath: '/',
      rootLabel: '/',
      listDir: (p) => window.api.sftp.list(sessionId, p),
      parentOf: remoteParent,
      join: remoteJoin,
      mkdir: (p) => window.api.sftp.mkdir(sessionId, p),
      rename: (oldPath, newPath) => window.api.sftp.rename(sessionId, oldPath, newPath),
      removeDir: (p) => window.api.sftp.remove(sessionId, p)
    }),
    [sessionId]
  )

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
      {/* 两行工具栏:第一行按钮,第二行独占的路径输入框(窄面板下路径不再被挤没)。 */}
      <div className="flex flex-col gap-1.5 border-b border-[var(--panel-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTree((v) => !v)}
            className={`rounded-lg px-2 py-1.5 hover:bg-[var(--nav-bg-hover)] ${
              showTree ? 'text-[var(--accent)]' : 'text-[var(--text-dark)]'
            }`}
            title={showTree ? '隐藏目录树' : '显示目录树'}
          >
            <PanelLeft size={14} />
          </button>
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
          {/* 只有贴着终端时才有意义:让那个终端 cd 到当前浏览的目录。 */}
          {terminalSessionId && (
            <button
              onClick={() => openInTerminal(path)}
              className="rounded-lg px-2 py-1.5 text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
              title="在终端中打开当前目录"
            >
              <Terminal size={14} />
            </button>
          )}
          {/* 反方向:把面板跳到终端此刻所在的目录。 */}
          {terminalSessionId && (
            <button
              onClick={() => void followTerminal()}
              disabled={following}
              className="rounded-lg px-2 py-1.5 text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)] disabled:opacity-50"
              title="在 SFTP 中打开终端当前所在的目录"
            >
              <FolderInput size={14} className={following ? 'animate-pulse' : ''} />
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={handleCreateFile}
            className="btn-secondary px-2.5 py-1.5"
            title="新建文件"
          >
            <FilePlus size={14} />
          </button>
          <button onClick={handleMkdir} className="btn-secondary px-2.5 py-1.5" title="新建文件夹">
            <FolderPlus size={14} />
          </button>
          <button onClick={handleUpload} className="btn-secondary px-2.5 py-1.5" title="上传文件">
            <Upload size={14} />
          </button>
          {embedded && onExpand && (
            <button
              onClick={onExpand}
              className="btn-primary px-2.5 py-1.5"
              title="展开为整页 SFTP"
            >
              <Maximize2 size={14} />
            </button>
          )}
        </div>
        <input
          value={editPath}
          onChange={(e) => setEditPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitPath()
            else if (e.key === 'Escape') setEditPath(path)
          }}
          spellCheck={false}
          title="输入路径后回车跳转"
          className="w-full min-w-0 rounded-lg bg-[var(--content-bg)] px-3 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
      </div>

      {navError && (
        <div className="border-b border-[var(--panel-border)] bg-red-50 px-3 py-1.5 text-xs text-red-600">
          {navError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {showTree && (
          <aside className="w-56 shrink-0 overflow-auto border-r border-[var(--panel-border)]">
            <DirectoryTree
              adapter={treeAdapter}
              selectedPath={path}
              onSelect={load}
              onChanged={() => load(path)}
              refreshToken={fsVersion}
              ask={ask}
            />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <FileTable
            entries={entries}
            onOpen={onOpen}
            dnd={dnd}
            menuActions={menuActions}
            dragOut={dragOut}
            emptyMenuActions={emptyMenuActions}
          />
        </div>
      </div>
      {promptNode}
    </div>
  )
}
