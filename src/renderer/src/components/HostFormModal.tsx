import { useState } from 'react'
import { useVaultStore } from '../store/useVaultStore'
import { Select } from './ui/Select'
import type { Host } from '@shared/types'

export function HostFormModal({
  host,
  onClose
}: {
  host?: Host
  onClose: () => void
}): React.ReactElement {
  const { addHost, updateHost, addGroup, groups, credentials } = useVaultStore()
  const [label, setLabel] = useState(host?.label ?? '')
  const [address, setAddress] = useState(host?.address ?? '')
  const [port, setPort] = useState(host?.port ?? 22)
  const [username, setUsername] = useState(host?.username ?? 'root')
  const [groupId, setGroupId] = useState(host?.groupId ?? '')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [authType, setAuthType] = useState<Host['authType']>(host?.authType ?? 'password')
  const [password, setPassword] = useState(host?.password ?? '')
  const [privateKey, setPrivateKey] = useState(host?.privateKey ?? '')
  const [passphrase, setPassphrase] = useState(host?.passphrase ?? '')
  const [credentialId, setCredentialId] = useState(host?.credentialId ?? '')
  const [error, setError] = useState('')

  const CREATE_GROUP = '__create_group__'

  const handleCreateGroup = async (): Promise<void> => {
    const name = newGroupName.trim()
    if (!name) return
    const created = await addGroup({ name })
    setGroupId(created.id)
    setNewGroupName('')
    setCreatingGroup(false)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!label.trim() || !address.trim()) {
      setError('请填写主机名称和地址')
      return
    }
    const payload = {
      label,
      address,
      port,
      username,
      groupId: groupId || null,
      authType,
      password: authType === 'password' ? password : undefined,
      privateKey: authType === 'key' ? privateKey : undefined,
      passphrase: authType === 'key' ? passphrase : undefined,
      credentialId: authType === 'credential' ? credentialId || null : null,
      tags: host?.tags ?? []
    }
    if (host) {
      await updateHost(host.id, payload)
    } else {
      await addHost(payload)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="card w-[440px] max-h-[90vh] overflow-y-auto p-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-dark)]">
          {host ? '编辑主机' : '新建主机'}
        </h2>

        <Field label="名称">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="地址 / IP">
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="192.168.1.1"
          />
        </Field>
        <div className="flex gap-3">
          <Field label="端口" className="w-24">
            <input
              type="number"
              className="input"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </Field>
          <Field label="用户名" className="flex-1">
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
        </div>

        <Field label="分组">
          {creatingGroup ? (
            <div className="flex gap-2">
              <input
                className="input flex-1"
                autoFocus
                placeholder="新分组名称"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleCreateGroup()
                  } else if (e.key === 'Escape') {
                    setCreatingGroup(false)
                    setNewGroupName('')
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void handleCreateGroup()}
                className="btn-primary shrink-0"
              >
                创建
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingGroup(false)
                  setNewGroupName('')
                }}
                className="shrink-0 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
              >
                取消
              </button>
            </div>
          ) : (
            <Select
              value={groupId ?? ''}
              onChange={(v) => {
                if (v === CREATE_GROUP) {
                  setCreatingGroup(true)
                } else {
                  setGroupId(v)
                }
              }}
              options={[
                { value: '', label: '未分组' },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
                { value: CREATE_GROUP, label: '➕ 新建分组...' }
              ]}
            />
          )}
        </Field>

        <Field label="认证方式">
          <Select
            value={authType}
            onChange={(v) => setAuthType(v as Host['authType'])}
            options={[
              { value: 'password', label: '密码' },
              { value: 'key', label: '私钥' },
              { value: 'credential', label: '密钥库凭据' }
            ]}
          />
        </Field>

        {authType === 'password' && (
          <Field label="密码">
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}

        {authType === 'key' && (
          <>
            <Field label="私钥 (PEM)">
              <textarea
                className="input h-24 font-mono text-xs"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
            </Field>
            <Field label="私钥密码 (可选)">
              <input
                type="password"
                className="input"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </Field>
          </>
        )}

        {authType === 'credential' && (
          <Field label="选择凭据">
            <Select
              value={credentialId ?? ''}
              onChange={setCredentialId}
              placeholder="选择..."
              options={credentials.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
        )}

        {error && <div className="mb-3 text-sm text-[var(--danger)]">{error}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            取消
          </button>
          <button type="submit" className="btn-primary">
            保存
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  children,
  className = ''
}: {
  label: string
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <div className={`mb-3 ${className}`}>
      <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">{label}</label>
      {children}
    </div>
  )
}
