import { useState } from 'react'
import { Plus, KeyRound, Pencil, Trash2 } from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { Select } from './ui/Select'
import type { Credential } from '@shared/types'

export function KeychainView(): React.ReactElement {
  const { credentials, deleteCredential } = useVaultStore()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Credential | undefined>(undefined)

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--text-dark)]">密钥库</h2>
        <button
          onClick={() => {
            setEditing(undefined)
            setShowForm(true)
          }}
          className="btn-primary"
        >
          <Plus size={15} />
          新建凭据
        </button>
      </div>

      {credentials.length === 0 && (
        <div className="mt-20 text-center text-sm text-[var(--text-muted)]">还没有保存的凭据</div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {credentials.map((cred) => (
          <div key={cred.id} className="card group p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#6b7d8f] text-white">
                <KeyRound size={16} strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{cred.name}</div>
                <div className="truncate text-xs text-[var(--text-muted)]">
                  {cred.type === 'password' ? '密码认证' : '私钥认证'}
                </div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                <button
                  onClick={() => {
                    setEditing(cred)
                    setShowForm(true)
                  }}
                  className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => deleteCredential(cred.id)}
                  className="rounded-md p-1.5 text-[var(--danger)] hover:bg-red-50"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && <CredentialFormModal cred={editing} onClose={() => setShowForm(false)} />}
    </div>
  )
}

function CredentialFormModal({
  cred,
  onClose
}: {
  cred?: Credential
  onClose: () => void
}): React.ReactElement {
  const { addCredential, updateCredential } = useVaultStore()
  const [name, setName] = useState(cred?.name ?? '')
  const [type, setType] = useState<Credential['type']>(cred?.type ?? 'password')
  const [username, setUsername] = useState(cred?.username ?? '')
  const [password, setPassword] = useState(cred?.password ?? '')
  const [privateKey, setPrivateKey] = useState(cred?.privateKey ?? '')
  const [passphrase, setPassphrase] = useState(cred?.passphrase ?? '')

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const payload = {
      name,
      type,
      username,
      password: type === 'password' ? password : undefined,
      privateKey: type === 'key' ? privateKey : undefined,
      passphrase: type === 'key' ? passphrase : undefined
    }
    if (cred) {
      await updateCredential(cred.id, payload)
    } else {
      await addCredential(payload)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="card w-[420px] max-h-[90vh] overflow-y-auto p-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-dark)]">
          {cred ? '编辑凭据' : '新建凭据'}
        </h2>

        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">名称</label>
        <input className="input mb-3" value={name} onChange={(e) => setName(e.target.value)} />

        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">类型</label>
        <div className="mb-3">
          <Select
            value={type}
            onChange={(v) => setType(v as Credential['type'])}
            options={[
              { value: 'password', label: '密码' },
              { value: 'key', label: '私钥' }
            ]}
          />
        </div>

        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">用户名</label>
        <input
          className="input mb-3"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        {type === 'password' ? (
          <>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              密码
            </label>
            <input
              type="password"
              className="input mb-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              私钥 (PEM)
            </label>
            <textarea
              className="input mb-3 h-24 font-mono text-xs"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
            />
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              私钥密码 (可选)
            </label>
            <input
              type="password"
              className="input mb-3"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </>
        )}

        <div className="mt-2 flex justify-end gap-2">
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
