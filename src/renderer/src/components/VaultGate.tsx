import { useEffect, useState } from 'react'
import { useVaultStore } from '../store/useVaultStore'
import appIcon from '../assets/app-icon.png'

export function VaultGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { initialized, unlocked, checkStatus, createVault, unlock, setTrusted } = useVaultStore()
  const [checked, setChecked] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [trustSupported, setTrustSupported] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.vault.isTrustSupported().then(setTrustSupported)
  }, [])

  // On launch, silently try the password this device remembers before showing
  // the form. Runs once: a later manual lock should still ask for the password.
  useEffect(() => {
    void (async () => {
      try {
        await checkStatus()
        const s = useVaultStore.getState()
        if (s.initialized && !s.unlocked && s.trusted) await s.unlockTrusted()
      } finally {
        setChecked(true)
      }
    })()
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
        setBusy(false)
        return
      }
    } else {
      setBusy(true)
      try {
        await unlock(password)
      } catch {
        setError('密码错误,请重试')
        setBusy(false)
        return
      }
    }

    // The vault is open at this point; a failure to remember the password must
    // not be reported as a failed unlock.
    try {
      if (trustDevice) await setTrusted(true)
    } catch (err) {
      console.warn('无法信任此设备:', err)
    } finally {
      setBusy(false)
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

        <label
          className={`mb-4 flex items-start gap-2 ${trustSupported ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
        >
          <input
            type="checkbox"
            checked={trustDevice}
            disabled={!trustSupported}
            onChange={(e) => setTrustDevice(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
          />
          <span className="text-xs leading-relaxed text-[var(--text-muted)]">
            <span className="text-[var(--text-dark)]">信任此设备</span>
            <span className="ml-1">
              {trustSupported
                ? '下次打开将自动解锁,无需输入主密码。主密码会用系统凭据存储加密后保存在本机。'
                : '当前系统不支持安全存储,无法使用此功能。'}
            </span>
          </span>
        </label>

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
