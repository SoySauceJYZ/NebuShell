import { useEffect, useState } from 'react'
import { Plug, Copy, Check, RefreshCw, Eye, EyeOff, FileText } from 'lucide-react'
import type { McpStatus } from '@shared/types'

/** 设置页里的「MCP 服务」卡片:开关、地址、令牌、客户端配置。 */
export function McpSettingsCard(): React.ReactElement {
  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    void Promise.all([window.api.settings.get(), window.api.mcp.status()]).then(([s, st]) => {
      setEnabled(s.mcpEnabled)
      setToken(s.mcpToken)
      setStatus(st)
      setLoaded(true)
    })
  }, [])

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true)
    setEnabled(next)
    try {
      const s = await window.api.settings.set({ mcpEnabled: next })
      setToken(s.mcpToken)
      setStatus(await window.api.mcp.status())
    } finally {
      setBusy(false)
    }
  }

  const regen = async (): Promise<void> => {
    if (!window.confirm('重新生成后,已配置旧令牌的智能体将无法连接,需要更新配置。继续?')) return
    setToken(await window.api.mcp.regenToken())
  }

  const copy = (key: string, text: string): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      window.setTimeout(() => setCopied(''), 1500)
    })
  }

  const url = status?.urls[0] ?? ''
  const claudeCmd = `claude mcp add --transport http nebushell ${url} --header "Authorization: Bearer ${token}"`
  const jsonCfg = JSON.stringify(
    {
      mcpServers: {
        nebushell: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } }
      }
    },
    null,
    2
  )

  const CopyBtn = ({ k, text, label }: { k: string; text: string; label: string }): React.ReactElement => (
    <button onClick={() => copy(k, text)} className="btn-secondary">
      {copied === k ? <Check size={14} /> : <Copy size={14} />}
      {copied === k ? '已复制' : label}
    </button>
  )

  return (
    <div className="card mt-4 max-w-xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <Plug size={16} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--text-dark)]">MCP 服务</div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            开启后,Claude Code、Cursor 等支持 MCP 的智能体可以连接 NebuShell,使用你已保存的服务器执行命令、
            读写文件、查看 Docker。需先解锁保险库。
          </p>

          <label className="mt-4 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!loaded || busy}
              onChange={(e) => void toggle(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text-dark)]">
              {enabled ? '已开启 MCP 服务' : '开启 MCP 服务'}
            </span>
          </label>

          {enabled && status && !status.running && (
            <div className="mt-2 text-xs text-[var(--danger)]">
              启动失败{status.error ? `:${status.error}` : ''}
            </div>
          )}

          {enabled && status?.running && (
            <div className="mt-3 space-y-3">
              <div className="rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--content-bg)] p-2.5 text-xs text-[var(--text-dark)]">
                <div className="mb-1 text-[11px] text-[var(--text-muted)]">连接地址</div>
                {status.urls.map((u) => (
                  <div key={u} className="break-all font-mono">
                    {u}
                  </div>
                ))}
              </div>

              <div>
                <div className="mb-1 text-[11px] text-[var(--text-muted)]">访问令牌 (Bearer)</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--content-bg)] px-2 py-1 text-xs text-[var(--text-dark)]">
                    {showToken ? token : '•'.repeat(24)}
                  </code>
                  <button
                    onClick={() => setShowToken((v) => !v)}
                    className="btn-secondary"
                    title={showToken ? '隐藏' : '显示'}
                  >
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button onClick={() => void regen()} className="btn-secondary" title="重新生成">
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <CopyBtn k="cmd" text={claudeCmd} label="复制 Claude Code 命令" />
                <CopyBtn k="json" text={jsonCfg} label="复制 JSON 配置" />
                <button onClick={() => void window.api.mcp.showAuditLog()} className="btn-secondary">
                  <FileText size={14} />
                  审计日志
                </button>
              </div>

              <p className="text-[11px] leading-relaxed text-amber-500">
                注意:服务监听所有网卡(局域网可访问),智能体执行的命令不会再弹窗确认。请勿泄露令牌;
                首次开启时 Windows 防火墙可能弹出放行提示。所有调用都记录在审计日志中。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
