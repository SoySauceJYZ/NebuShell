import { useEffect, useState } from 'react'
import { useVaultStore } from '../store/useVaultStore'
import appIcon from '../assets/app-icon.png'

export function VaultGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { initialized, unlocked, checkStatus, createVault, unlock } = useVaultStore()
  const [checked, setChecked] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    checkStatus().finally(() => setChecked(true))
  }, [checkStatus])

  if (!checked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--content-bg)] text-sm text-[var(--text-muted)]">
        <DragStrip />
        加载中...
      </div>
    )
  }

  if (unlocked) return <>{children}</>

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    if (!initialized) {
      if (password.length < 6) {
        setError('主密码至少需要 6 位')
        return
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致')
        return
      }
      setBusy(true)
      try {
        await createVault(password)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    } else {
      setBusy(true)
      try {
        await unlock(password)
      } catch (err) {
        setError('密码错误,请重试')
      } finally {
        setBusy(false)
      }
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--content-bg)]">
      <DragStrip />
      <form onSubmit={handleSubmit} className="card w-[380px] p-8">
        <div className="mb-6 text-center">
          <img
            src={appIcon}
            alt="NebuShell"
            className="mx-auto mb-3 h-16 w-16 rounded-2xl object-contain drop-shadow-sm"
          />
          <h1 className="text-xl font-semibold text-[var(--text-dark)]">NebuShell</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            由 AI 智能体驱动的运维终端
          </p>
          <p className="mt-2.5 text-xs text-[var(--text-muted)]">
            {initialized ? '输入主密码解锁保险库' : '创建主密码以初始化保险库'}
          </p>
        </div>

        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">主密码</label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mb-4"
          placeholder="••••••••"
        />

        {!initialized && (
          <>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              确认主密码
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input mb-4"
              placeholder="••••••••"
            />
          </>
        )}

        {error && <div className="mb-3 text-sm text-[var(--danger)]">{error}</div>}

        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
          {busy ? '处理中...' : initialized ? '解锁' : '创建保险库'}
        </button>
      </form>
    </div>
  )
}

function DragStrip(): React.ReactElement {
  return (
    <div
      className="fixed inset-x-0 top-0 h-10"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    />
  )
}
