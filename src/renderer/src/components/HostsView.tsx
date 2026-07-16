import { useMemo, useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Plus,
  FolderPlus,
  FolderCog,
  Server,
  Play,
  FolderOpen,
  Pencil,
  Trash2,
  Download,
  Upload,
  Save,
  Copy,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Search,
  X,
  Container
} from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import { useTerminalStore } from '../store/useTerminalStore'
import { HostFormModal } from './HostFormModal'
import { Select } from './ui/Select'
import type { Host, Group, Credential } from '@shared/types'

export function HostsView(): React.ReactElement {
  const {
    hosts,
    groups,
    credentials,
    addHost,
    addGroup,
    updateGroup,
    deleteGroup,
    reorderGroups,
    deleteHost,
    exportVault,
    importPickFile,
    importVault
  } = useVaultStore()
  const { openTab } = useSessionStore()
  const [selectedId, setSelectedId] = useState<string | null>(hosts[0]?.id ?? null)
  const [showForm, setShowForm] = useState(false)
  const [editingHost, setEditingHost] = useState<Host | undefined>(undefined)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [importContent, setImportContent] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const startImport = async (): Promise<void> => {
    const content = await importPickFile()
    if (content) setImportContent(content)
  }

  const selected = useMemo(
    () => hosts.find((h) => h.id === selectedId) ?? null,
    [hosts, selectedId]
  )

  // Group hosts, then emit sections in the group array's own order (which the
  // group manager controls) so reordering groups reorders the list below.
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = q
      ? hosts.filter(
          (h) => h.label.toLowerCase().includes(q) || h.address.toLowerCase().includes(q)
        )
      : hosts
    const map = new Map<string | null, Host[]>()
    for (const h of visible) {
      const key = h.groupId ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(h)
    }
    const ordered: { groupId: string | null; hosts: Host[] }[] = []
    for (const g of groups) {
      const hs = map.get(g.id)
      if (hs && hs.length) ordered.push({ groupId: g.id, hosts: hs })
    }
    const ungrouped = map.get(null)
    if (ungrouped && ungrouped.length) ordered.push({ groupId: null, hosts: ungrouped })
    return ordered
  }, [hosts, groups, query])

  const connect = (host: Host): void => {
    openTab({
      id: `terminal-${host.id}-${Date.now()}`,
      kind: 'terminal',
      title: host.label,
      hostId: host.id
    })
  }

  const duplicateHost = async (host: Host): Promise<void> => {
    await addHost({
      label: `${host.label} 副本`,
      address: host.address,
      port: host.port,
      username: host.username,
      groupId: host.groupId ?? null,
      authType: host.authType,
      password: host.password,
      privateKey: host.privateKey,
      passphrase: host.passphrase,
      credentialId: host.credentialId ?? null,
      tags: host.tags ?? []
    })
  }

  const openSftp = (host: Host): void => {
    openTab({
      id: `explorer-${host.id}-${Date.now()}`,
      kind: 'explorer',
      title: `${host.label} (SFTP)`,
      hostId: host.id
    })
  }

  // 连接主机并直接展开右侧「容器」面板
  const openContainers = (host: Host): void => {
    useTerminalStore.getState().setRightPanel('docker')
    connect(host)
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="shrink-0 text-base font-semibold text-[var(--text-dark)]">主机</h2>
            <div className="relative w-56 max-w-full">
              <Search
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                className="input pl-8 pr-8"
                placeholder="搜索名称或地址"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="清除搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => void startImport()} className="btn-secondary">
              <Upload size={15} />
              导入
            </button>
            <button
              onClick={() => setShowExport(true)}
              disabled={hosts.length === 0 && groups.length === 0 && credentials.length === 0}
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={15} />
              导出
            </button>
            <div className="flex">
              <button
                onClick={() => setShowGroupForm(true)}
                className="btn-secondary rounded-r-none"
              >
                <FolderPlus size={15} />
                新建分组
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  className="btn-secondary -ml-px rounded-l-none px-2"
                  aria-label="分组管理"
                >
                  <ChevronDown size={15} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-[70] min-w-[160px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
                  >
                    <DropdownMenu.Item
                      onSelect={() => setShowGroupManager(true)}
                      disabled={groups.length === 0}
                      className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-[var(--nav-bg-hover)] data-[disabled]:opacity-50"
                    >
                      <FolderCog size={15} className="text-[var(--text-muted)]" />
                      管理分组
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            <button
              onClick={() => {
                setEditingHost(undefined)
                setShowForm(true)
              }}
              className="btn-primary"
            >
              <Plus size={15} />
              新建主机
            </button>
          </div>
        </div>

        {hosts.length === 0 && (
          <div className="mt-20 text-center text-sm text-[var(--text-muted)]">
            还没有主机,点击“新建主机”添加一个
          </div>
        )}

        {hosts.length > 0 && sections.length === 0 && query.trim() && (
          <div className="mt-20 text-center text-sm text-[var(--text-muted)]">
            没有匹配「{query.trim()}」的主机
          </div>
        )}

        {sections.map(({ groupId, hosts: groupHosts }) => (
          <div key={groupId ?? 'ungrouped'} className="mb-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {groupId ? (groups.find((g) => g.id === groupId)?.name ?? '分组') : '未分组'}
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {groupHosts.map((host) => (
                <ContextMenu.Root key={host.id}>
                  <ContextMenu.Trigger asChild>
                    <div
                      onClick={() => setSelectedId(host.id)}
                      onDoubleClick={() => connect(host)}
                      onContextMenu={() => setSelectedId(host.id)}
                      className={`card cursor-pointer p-3 transition ${
                        selectedId === host.id
                          ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                          : 'hover:border-[var(--accent)]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
                          <Server size={16} strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{host.label}</div>
                          <div className="truncate text-xs text-[var(--text-muted)]">
                            {host.username}@{host.address}
                          </div>
                        </div>
                      </div>
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="z-[70] min-w-[160px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
                      <ContextMenu.Item
                        onSelect={() => connect(host)}
                        className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                      >
                        <Play size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                        连接
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onSelect={() => openContainers(host)}
                        className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                      >
                        <Container size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                        查看容器
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onSelect={() => void duplicateHost(host)}
                        className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                      >
                        <Copy size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                        复制
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onSelect={() => {
                          setEditingHost(host)
                          setShowForm(true)
                        }}
                        className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                      >
                        <Pencil size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                        编辑
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <HostDetailPanel
          key={selected.id}
          host={selected}
          groups={groups}
          credentials={credentials}
          onConnect={connect}
          onOpenSftp={openSftp}
          onOpenContainers={openContainers}
          onEditFull={() => {
            setEditingHost(selected)
            setShowForm(true)
          }}
          onDelete={async () => {
            await deleteHost(selected.id)
            setSelectedId(null)
          }}
        />
      )}

      {showForm && <HostFormModal host={editingHost} onClose={() => setShowForm(false)} />}
      {showGroupForm && (
        <GroupFormModal
          onClose={() => setShowGroupForm(false)}
          onCreate={async (name) => {
            await addGroup({ name })
            setShowGroupForm(false)
          }}
        />
      )}
      {showGroupManager && (
        <GroupManagerModal
          groups={groups}
          hosts={hosts}
          onClose={() => setShowGroupManager(false)}
          onRename={(id, name) => updateGroup(id, { name })}
          onReorder={reorderGroups}
          onDelete={deleteGroup}
        />
      )}
      {showExport && (
        <ExportModal
          hostCount={hosts.length}
          groupCount={groups.length}
          credentialCount={credentials.length}
          onClose={() => setShowExport(false)}
          onExport={exportVault}
        />
      )}
      {importContent !== null && (
        <ImportModal
          content={importContent}
          onClose={() => setImportContent(null)}
          onImport={importVault}
        />
      )}
    </div>
  )
}

function ExportModal({
  hostCount,
  groupCount,
  credentialCount,
  onClose,
  onExport
}: {
  hostCount: number
  groupCount: number
  credentialCount: number
  onClose: () => void
  onExport: (password: string) => Promise<string | null>
}): React.ReactElement {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (password.length < 4) {
      setError('导出密码至少 4 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    try {
      const path = await onExport(password)
      if (path) setSavedPath(path)
      else onClose() // user cancelled the save dialog
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
      setBusy(false)
    }
  }

  if (savedPath) {
    return (
      <ModalShell onClose={onClose} title="导出成功">
        <p className="text-sm text-[var(--text-muted)]">文件已保存到:</p>
        <div className="mt-2 break-all rounded-lg border border-[var(--panel-border)] bg-gray-50 px-3 py-2 text-xs">
          {savedPath}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-primary">
            完成
          </button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={onClose} title="导出主机数据">
      <form onSubmit={submit}>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          将导出 {hostCount} 台主机、{groupCount} 个分组、{credentialCount}{' '}
          条密钥库凭据(含密码与私钥)。 文件使用下面的密码加密,导入时需要输入相同的密码。
        </p>
        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">导出密码</label>
        <input
          type="password"
          className="input"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="mb-1 mt-3 block text-xs font-medium text-[var(--text-muted)]">
          确认密码
        </label>
        <input
          type="password"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <div className="mt-2 text-sm text-[var(--danger)]">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            取消
          </button>
          <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
            {busy ? '导出中...' : '选择位置并导出'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function ImportModal({
  content,
  onClose,
  onImport
}: {
  content: string
  onClose: () => void
  onImport: (
    password: string,
    content: string
  ) => Promise<{
    hosts: number
    groups: number
    credentials: number
  }>
}): React.ReactElement {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    hosts: number
    groups: number
    credentials: number
  } | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!password) {
      setError('请输入导出时设置的密码')
      return
    }
    setBusy(true)
    setError('')
    try {
      const r = await onImport(password, content)
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
      setBusy(false)
    }
  }

  if (result) {
    return (
      <ModalShell onClose={onClose} title="导入成功">
        <p className="text-sm text-[var(--text-muted)]">
          已导入 {result.hosts} 台主机、{result.groups} 个分组、{result.credentials}{' '}
          条密钥库凭据,可直接连接使用。
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-primary">
            完成
          </button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={onClose} title="导入主机数据">
      <form onSubmit={submit}>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          导入的数据会合并到当前主机列表(不会覆盖现有条目)。请输入导出该文件时设置的密码。
        </p>
        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">导出密码</label>
        <input
          type="password"
          className="input"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="mt-2 text-sm text-[var(--danger)]">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            取消
          </button>
          <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
            {busy ? '导入中...' : '导入'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function ModalShell({
  title,
  children,
  onClose
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div className="card w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-dark)]">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function GroupFormModal({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}): React.ReactElement {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim()) {
      setError('请填写分组名称')
      return
    }
    await onCreate(name.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={submit} className="card w-[380px] p-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-dark)]">新建分组</h2>
        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">名称</label>
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如:生产环境"
        />
        {error && <div className="mt-2 text-sm text-[var(--danger)]">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            取消
          </button>
          <button type="submit" className="btn-primary">
            创建
          </button>
        </div>
      </form>
    </div>
  )
}

function GroupManagerModal({
  groups,
  hosts,
  onClose,
  onRename,
  onReorder,
  onDelete
}: {
  groups: Group[]
  hosts: Host[]
  onClose: () => void
  onRename: (id: string, name: string) => Promise<void>
  onReorder: (orderedIds: string[]) => Promise<void>
  onDelete: (id: string) => Promise<void>
}): React.ReactElement {
  const [items, setItems] = useState(() => groups.map((g) => ({ id: g.id, name: g.name })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const move = (index: number, dir: -1 | 1): void => {
    setItems((prev) => {
      const j = index + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  const rename = (id: string, name: string): void => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, name } : it)))
  }

  const remove = async (id: string): Promise<void> => {
    const count = hosts.filter((h) => h.groupId === id).length
    const name = items.find((it) => it.id === id)?.name ?? '该分组'
    const msg =
      count > 0
        ? `删除分组「${name}」?其中 ${count} 台主机会变为未分组(主机不会被删除)。`
        : `删除分组「${name}」?`
    if (!window.confirm(msg)) return
    await onDelete(id)
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const save = async (): Promise<void> => {
    if (items.some((it) => !it.name.trim())) {
      setError('分组名称不能为空')
      return
    }
    setBusy(true)
    setError('')
    try {
      for (const it of items) {
        const orig = groups.find((g) => g.id === it.id)
        const name = it.name.trim()
        if (orig && orig.name !== name) await onRename(it.id, name)
      }
      await onReorder(items.map((it) => it.id))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title="管理分组">
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        重命名分组,或用箭头调整顺序。顺序会影响主机列表中分组的显示排列。
      </p>
      {items.length === 0 ? (
        <div className="py-6 text-center text-sm text-[var(--text-muted)]">还没有分组</div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <div key={it.id} className="flex items-center gap-2">
              <input
                className="input flex-1"
                value={it.name}
                onChange={(e) => rename(it.id, e.target.value)}
              />
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="上移"
                  className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  title="下移"
                  className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(it.id)}
                  title="删除分组"
                  className="rounded p-1.5 text-[var(--text-muted)] hover:bg-red-50 hover:text-[var(--danger)]"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div className="mt-2 text-sm text-[var(--danger)]">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          {busy ? '保存中...' : '保存'}
        </button>
      </div>
    </ModalShell>
  )
}

function HostDetailPanel({
  host,
  groups,
  credentials,
  onConnect,
  onOpenSftp,
  onOpenContainers,
  onEditFull,
  onDelete
}: {
  host: Host
  groups: Group[]
  credentials: Credential[]
  onConnect: (h: Host) => void
  onOpenSftp: (h: Host) => void
  onOpenContainers: (h: Host) => void
  onEditFull: () => void
  onDelete: () => void | Promise<void>
}): React.ReactElement {
  const { updateHost } = useVaultStore()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [label, setLabel] = useState(host.label)
  const [address, setAddress] = useState(host.address)
  const [port, setPort] = useState(host.port)
  const [username, setUsername] = useState(host.username)
  const [groupId, setGroupId] = useState(host.groupId ?? '')
  const [authType, setAuthType] = useState<Host['authType']>(host.authType)
  const [password, setPassword] = useState(host.password ?? '')
  const [privateKey, setPrivateKey] = useState(host.privateKey ?? '')
  const [passphrase, setPassphrase] = useState(host.passphrase ?? '')
  const [credentialId, setCredentialId] = useState(host.credentialId ?? '')

  const resetFields = (): void => {
    setLabel(host.label)
    setAddress(host.address)
    setPort(host.port)
    setUsername(host.username)
    setGroupId(host.groupId ?? '')
    setAuthType(host.authType)
    setPassword(host.password ?? '')
    setPrivateKey(host.privateKey ?? '')
    setPassphrase(host.passphrase ?? '')
    setCredentialId(host.credentialId ?? '')
  }

  const cancelEdit = (): void => {
    resetFields()
    setError('')
    setEditing(false)
  }

  const save = async (): Promise<void> => {
    if (!label.trim() || !address.trim()) {
      setError('请填写主机名称和地址')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateHost(host.id, {
        label,
        address,
        port,
        username,
        groupId: groupId || null,
        authType,
        password: authType === 'password' ? password : undefined,
        privateKey: authType === 'key' ? privateKey : undefined,
        passphrase: authType === 'key' ? passphrase : undefined,
        credentialId: authType === 'credential' ? credentialId || null : null
      })
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-80 shrink-0 overflow-y-auto border-l border-[var(--panel-border)] bg-[var(--panel-bg)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--text-dark)]">主机详情</h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--nav-bg-hover)]"
          >
            <Pencil size={13} />
            直接编辑
          </button>
        )}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <SectionLabel>地址</SectionLabel>
          <input
            className="input mb-2"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="192.168.1.1"
          />

          <SectionLabel>常规</SectionLabel>
          <input
            className="input mb-2"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="名称"
          />
          <Select
            value={groupId}
            onChange={setGroupId}
            className="mb-2"
            options={[
              { value: '', label: '未分组' },
              ...groups.map((g) => ({ value: g.id, label: g.name }))
            ]}
          />

          <SectionLabel>SSH</SectionLabel>
          <div className="mb-2 flex gap-2">
            <input
              className="input flex-1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
            />
            <input
              type="number"
              className="input w-20"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              placeholder="端口"
            />
          </div>

          <SectionLabel>认证方式</SectionLabel>
          <Select
            value={authType}
            onChange={(v) => setAuthType(v as Host['authType'])}
            className="mb-2"
            options={[
              { value: 'password', label: '密码' },
              { value: 'key', label: '私钥' },
              { value: 'credential', label: '密钥库凭据' }
            ]}
          />

          {authType === 'password' && (
            <input
              type="password"
              className="input mb-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
            />
          )}

          {authType === 'key' && (
            <>
              <textarea
                className="input mb-2 h-20 font-mono text-xs"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="私钥 (PEM)"
              />
              <input
                type="password"
                className="input mb-2"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="私钥密码 (可选)"
              />
            </>
          )}

          {authType === 'credential' && (
            <Select
              value={credentialId}
              onChange={setCredentialId}
              className="mb-2"
              placeholder="选择凭据..."
              options={credentials.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}

          {error && <div className="mt-2 text-sm text-[var(--danger)]">{error}</div>}

          <div className="mt-6 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              <Save size={15} />
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--panel-border)] px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
            >
              <X size={15} />
              取消
            </button>
          </div>
        </form>
      ) : (
        <>
          <SectionLabel>地址</SectionLabel>
          <ValueBox>{host.address}</ValueBox>

          <SectionLabel>常规</SectionLabel>
          <ValueBox>{host.label}</ValueBox>
          <ValueBox>{groups.find((g) => g.id === host.groupId)?.name ?? '未分组'}</ValueBox>

          <SectionLabel>SSH</SectionLabel>
          <ValueBox>
            {host.username} · 端口 {host.port}
          </ValueBox>

          {host.authType === 'credential' && (
            <>
              <SectionLabel>凭据</SectionLabel>
              <ValueBox>
                {credentials.find((c) => c.id === host.credentialId)?.name ?? '未选择'}
              </ValueBox>
            </>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={() => onConnect(host)} className="btn-primary">
              <Play size={15} />
              连接
            </button>
            <button onClick={() => onOpenSftp(host)} className="btn-secondary">
              <FolderOpen size={15} />
              打开 SFTP
            </button>
            <button onClick={() => onOpenContainers(host)} className="btn-secondary">
              <Container size={15} />
              查看容器
            </button>
            <div className="flex gap-2">
              <button onClick={onEditFull} className="btn-secondary flex-1">
                <Pencil size={14} />
                编辑
              </button>
              <button
                onClick={() => void onDelete()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-red-200 py-2 text-sm font-medium text-[var(--danger)] hover:bg-red-50"
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] first:mt-0">
      {children}
    </div>
  )
}

function ValueBox({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-2 rounded-lg border border-[var(--panel-border)] bg-gray-50 px-3 py-2 text-sm">
      {children}
    </div>
  )
}
