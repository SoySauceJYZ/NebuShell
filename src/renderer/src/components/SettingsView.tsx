import { useEffect, useState } from 'react'
import { Gauge, RotateCcw, Check, ShieldCheck } from 'lucide-react'
import {
  DEFAULT_TRANSFER_CONCURRENCY,
  MIN_TRANSFER_CONCURRENCY,
  MAX_TRANSFER_CONCURRENCY
} from '@shared/types'
import { useVaultStore } from '../store/useVaultStore'

function clamp(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TRANSFER_CONCURRENCY
  return Math.min(MAX_TRANSFER_CONCURRENCY, Math.max(MIN_TRANSFER_CONCURRENCY, Math.round(n)))
}

export function SettingsView(): React.ReactElement {
  const [concurrency, setConcurrency] = useState(DEFAULT_TRANSFER_CONCURRENCY)
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)

  const { trusted, setTrusted } = useVaultStore()
  const [trustSupported, setTrustSupported] = useState(true)
  const [trustError, setTrustError] = useState('')

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setConcurrency(s.transferConcurrency)
      setLoaded(true)
    })
    window.api.vault.isTrustSupported().then(setTrustSupported)
  }, [])

  const toggleTrust = async (next: boolean): Promise<void> => {
    setTrustError('')
    try {
      await setTrusted(next)
    } catch (err) {
      setTrustError(err instanceof Error ? err.message : String(err))
    }
  }

  // Persist (clamped) whenever the value changes, once the initial load is done.
  const commit = (value: number): void => {
    const v = clamp(value)
    setConcurrency(v)
    window.api.settings.set({ transferConcurrency: v }).then(() => {
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    })
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--text-dark)]">设置</h2>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-500">
            <Check size={13} />
            已保存
          </span>
        )}
      </div>

      <div className="card max-w-xl p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <Gauge size={16} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--text-dark)]">SFTP 传输并发数</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
              上传/下载单个文件时同时保持的 SFTP 请求数。数值越大在高延迟网络下越快;
              若服务器对并发敏感或出现不稳定,可适当调低。默认 {DEFAULT_TRANSFER_CONCURRENCY}。
            </p>

            <div className="mt-4 flex items-center gap-4">
              <input
                type="range"
                min={MIN_TRANSFER_CONCURRENCY}
                max={MAX_TRANSFER_CONCURRENCY}
                value={concurrency}
                disabled={!loaded}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                onMouseUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
                onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
                className="h-1.5 flex-1 cursor-pointer accent-[var(--accent)]"
              />
              <input
                type="number"
                min={MIN_TRANSFER_CONCURRENCY}
                max={MAX_TRANSFER_CONCURRENCY}
                value={concurrency}
                disabled={!loaded}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                onBlur={(e) => commit(Number(e.target.value))}
                className="w-20 rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--content-bg)] px-2 py-1 text-center text-sm text-[var(--text-dark)]"
              />
              <button
                onClick={() => commit(DEFAULT_TRANSFER_CONCURRENCY)}
                disabled={!loaded}
                className="btn-secondary shrink-0"
                title="恢复默认"
              >
                <RotateCcw size={14} />
                默认
              </button>
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              范围 {MIN_TRANSFER_CONCURRENCY} – {MAX_TRANSFER_CONCURRENCY}
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-4 max-w-xl p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <ShieldCheck size={16} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--text-dark)]">信任此设备</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
              开启后,下次打开应用会自动解锁保险库,无需输入主密码。主密码由操作系统的凭据存储
              (Windows DPAPI / macOS 钥匙串)加密后保存在本机。若此电脑可能被他人使用,请关闭。
            </p>

            <label
              className={`mt-4 flex items-center gap-2 ${
                trustSupported ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
              }`}
            >
              <input
                type="checkbox"
                checked={trusted}
                disabled={!trustSupported}
                onChange={(e) => void toggleTrust(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span className="text-sm text-[var(--text-dark)]">
                {trusted ? '已信任,启动时自动解锁' : '启动时需要输入主密码'}
              </span>
            </label>

            {!trustSupported && (
              <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                当前系统不支持安全存储,无法使用此功能。
              </div>
            )}
            {trustError && <div className="mt-2 text-xs text-[var(--danger)]">{trustError}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
