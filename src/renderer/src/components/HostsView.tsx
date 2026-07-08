import { useMemo, useState } from 'react'
import {
  Plus,
  FolderPlus,
  Server,
  Play,
  FolderOpen,
  Pencil,
  Trash2,
  Download,
  Upload
} from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import { HostFormModal } from './HostFormModal'
import type { Host } from '@shared/types'

export function HostsView(): React.ReactElement {
  const {
    hosts,
    groups,
    credentials,
    addGroup,
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
  const [showExport, setShowExport] = useState(false)
  const [importContent, setImportContent] = useState<string | null>(null)

  const startImport = async (): Promise<void> => {
    const content = await importPickFile()
    if (content) setImportContent(content)
  }

  const selected = useMemo(
    () => hosts.find((h) => h.id === selectedId) ?? null,
    [hosts, selectedId]
  )

  const grouped = useMemo(() => {
    const map = new Map<string | null, Host[]>()
    for (const h of hosts) {
      const key = h.groupId ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(h)
    }
    return map
  }, [hosts])

  const connect = (host: Host): void => {
    openTab({
      id: `terminal-${host.id}-${Date.now()}`,
      kind: 'terminal',
      title: host.label,
      hostId: host.id
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

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-dark)]">主机</h2>
          <div className="flex gap-2">
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
            <button onClick={() => setShowGroupForm(true)} className="btn-secondary">
              <FolderPlus size={15} />
              新建分组
            </button>
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

        {Array.from(grouped.entries()).map(([groupId, groupHosts]) => (
          <div key={groupId ?? 'ungrouped'} className="mb-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {groupId ? (groups.find((g) => g.id === groupId)?.name ?? '分组') : '未分组'}
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {groupHosts.map((host) => (
                <div
                  key={host.id}
                  onClick={() => setSelectedId(host.id)}
                  onDoubleClick={() => connect(host)}
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
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="w-80 shrink-0 overflow-y-auto border-l border-[var(--panel-border)] bg-[var(--panel-bg)] p-5">
          <h3 className="mb-4 text-base font-semibold text-[var(--text-dark)]">主机详情</h3>

          <SectionLabel>地址</SectionLabel>
          <ValueBox>{selected.address}</ValueBox>

          <SectionLabel>常规</SectionLabel>
          <ValueBox>{selected.label}</ValueBox>
          <ValueBox>{groups.find((g) => g.id === selected.groupId)?.name ?? '未分组'}</ValueBox>

          <SectionLabel>SSH</SectionLabel>
          <ValueBox>
            {selected.username} · 端口 {selected.port}
          </ValueBox>

          {selected.authType === 'credential' && (
            <>
              <SectionLabel>凭据</SectionLabel>
              <ValueBox>
                {credentials.find((c) => c.id === selected.credentialId)?.name ?? '未选择'}
              </ValueBox>
            </>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={() => connect(selected)} className="btn-primary">
              <Play size={15} />
              连接
            </button>
            <button onClick={() => openSftp(selected)} className="btn-secondary">
              <FolderOpen size={15} />
              打开 SFTP
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditingHost(selected)
                  setShowForm(true)
                }}
                className="btn-secondary flex-1"
              >
                <Pencil size={14} />
                编辑
              </button>
              <button
                onClick={async () => {
                  await deleteHost(selected.id)
                  setSelectedId(null)
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-red-200 py-2 text-sm font-medium text-[var(--danger)] hover:bg-red-50"
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>
          </div>
        </div>
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
