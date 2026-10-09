import { useEffect, useMemo, useState } from 'react'
import {
  Globe,
  Plus,
  ListPlus,
  Activity,
  Pencil,
  Trash2,
  Copy,
  Lock,
  Loader2,
  Search,
  Bot,
  Eraser
} from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { Select } from './ui/Select'
import {
  PROXY_TYPE_LABEL,
  checkProxies,
  checkProxy,
  flagEmoji,
  latencyTone,
  parseProxyLine,
  parseProxyLines,
  proxyUrl,
  regionText,
  useProxyUiStore,
  type NewProxy
} from '../lib/proxies'
import {
  PROXY_LOCAL_KEY,
  type AgentProxyMode,
  type ProxyCheckResult,
  type ProxyEntry,
  type ProxyType
} from '@shared/types'

const TYPE_OPTIONS = (Object.keys(PROXY_TYPE_LABEL) as ProxyType[]).map((t) => ({
  value: t,
  label: PROXY_TYPE_LABEL[t]
}))

const AGENT_MODES: { id: AgentProxyMode; label: string; hint: string }[] = [
  { id: 'off', label: '关闭', hint: '智能体不会使用代理' },
  { id: 'ask', label: '询问', hint: '遇到外网连接问题时,先请你确认再使用代理' },
  { id: 'auto', label: '自动', hint: '遇到外网连接问题时,自动挑选可用且延迟最低的代理' }
]

const TONE_CLASS = {
  good: 'text-emerald-600',
  mid: 'text-amber-600',
  bad: 'text-[var(--danger)]'
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return new Date(ts).toLocaleDateString()
}

const sameProxy = (a: NewProxy, b: NewProxy): boolean =>
  a.type === b.type &&
  a.host.toLowerCase() === b.host.toLowerCase() &&
  a.port === b.port &&
  (a.username ?? '') === (b.username ?? '')

/** Left-nav「代理」页:管理代理列表,并在本机或任一主机上检测出口 IP / 地区 / 延迟。 */
export function ProxiesView(): React.ReactElement {
  const proxies = useVaultStore((s) => s.proxies)
  const hosts = useVaultStore((s) => s.hosts)
  const deleteProxies = useVaultStore((s) => s.deleteProxies)
  const checking = useProxyUiStore((s) => s.checking)
  const agentMode = useProxyUiStore((s) => s.agentMode)
  const setAgentMode = useProxyUiStore((s) => s.setAgentMode)
  const hydrate = useProxyUiStore((s) => s.hydrate)

  const [target, setTarget] = useState<string>(PROXY_LOCAL_KEY)
  const [query, setQuery] = useState('')
  const [sortByLatency, setSortByLatency] = useState(false)
  const [form, setForm] = useState<{ open: boolean; editing?: ProxyEntry }>({ open: false })
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // 选中的主机被删了就退回本机。
  const targetKey =
    target === PROXY_LOCAL_KEY || hosts.some((h) => h.id === target) ? target : PROXY_LOCAL_KEY
  const targetLabel =
    targetKey === PROXY_LOCAL_KEY ? '本机' : (hosts.find((h) => h.id === targetKey)?.label ?? '')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = proxies.filter((p) => {
      if (!q) return true
      const r = p.checks?.[targetKey]
      return [p.name, p.host, String(p.port), p.remark, r?.exitIp, regionText(r), r?.isp]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q))
    })
    if (!sortByLatency) return list
    const key = (p: ProxyEntry): number => {
      const r = p.checks?.[targetKey]
      if (!r) return 2e9
      return r.ok ? (r.latencyMs ?? 1e9) : 1.5e9
    }
    return [...list].sort((a, b) => key(a) - key(b))
  }, [proxies, query, sortByLatency, targetKey])

  const anyChecking = rows.some((p) => checking[`${p.id}|${targetKey}`])
  const failedIds = proxies.filter((p) => p.checks?.[targetKey]?.ok === false).map((p) => p.id)
  const okCount = proxies.filter((p) => p.checks?.[targetKey]?.ok).length

  const removeWithConfirm = async (ids: string[], what: string): Promise<void> => {
    if (ids.length === 0) return
    const ok = await window.api.dialog.confirm({
      message: what,
      detail: '删除后无法恢复。',
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (ok) await deleteProxies(ids)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <Globe size={20} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-[var(--text-dark)]">代理</h1>
          <p className="text-xs text-[var(--text-muted)]">
            管理 HTTP / SOCKS5 代理,检测出口 IP、地区与延迟;智能体在服务器上访问外网受阻时可选用。
          </p>
        </div>
        <button onClick={() => setImportOpen(true)} className="btn-secondary">
          <ListPlus size={15} />
          批量导入
        </button>
        <button onClick={() => setForm({ open: true })} className="btn-primary">
          <Plus size={15} />
          添加代理
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">检测位置</span>
        <div className="w-56">
          <Select
            value={targetKey}
            onChange={setTarget}
            options={[
              { value: PROXY_LOCAL_KEY, label: '本机' },
              ...hosts.map((h) => ({ value: h.id, label: `${h.label}(${h.address})` }))
            ]}
          />
        </div>
        <button
          disabled={proxies.length === 0 || anyChecking}
          onClick={() =>
            void checkProxies(
              rows.map((p) => p.id),
              targetKey
            )
          }
          className="btn-secondary disabled:opacity-50"
          title={`在${targetLabel}上检测列表中的全部代理`}
        >
          {anyChecking ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}
          全部检测
        </button>
        {failedIds.length > 0 && (
          <button
            onClick={() =>
              void removeWithConfirm(
                failedIds,
                `删除在「${targetLabel}」上检测失败的 ${failedIds.length} 个代理?`
              )
            }
            className="btn-secondary"
            title="删除在当前检测位置检测失败的代理"
          >
            <Eraser size={15} />
            清理不可用
          </button>
        )}
        <div className="relative ml-auto">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            className="input w-52 pl-8"
            placeholder="搜索名称 / IP / 地区"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2">
        <Bot size={15} className="text-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--text-dark)]">智能体使用代理</span>
        <div className="flex rounded-lg bg-[var(--content-bg)] p-0.5">
          {AGENT_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => void setAgentMode(m.id)}
              title={m.hint}
              className={`rounded-md px-3 py-1 text-xs transition ${
                agentMode === m.id
                  ? 'bg-[var(--panel-bg)] font-medium text-[var(--accent)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-dark)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          {AGENT_MODES.find((m) => m.id === agentMode)?.hint}。代理账号密码不会发送给模型。
        </span>
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          共 {proxies.length} 个 · {targetLabel}可用 {okCount} 个
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)]">
        {proxies.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
            <Globe size={32} className="text-[var(--text-muted)]" strokeWidth={1.5} />
            <p className="text-sm text-[var(--text-muted)]">还没有代理</p>
            <p className="max-w-sm text-xs text-[var(--text-muted)]">
              点「添加代理」逐个添加,或「批量导入」一次粘贴多行(如
              socks5://user:pass@1.2.3.4:1080)。
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--nav-bg)] text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">地址</th>
                <th className="px-3 py-2 font-medium">出口 IP</th>
                <th className="px-3 py-2 font-medium">地区</th>
                <th
                  className="cursor-pointer select-none px-3 py-2 font-medium hover:text-[var(--text-dark)]"
                  onClick={() => setSortByLatency((v) => !v)}
                  title="点击按延迟排序"
                >
                  延迟 {sortByLatency ? '↑' : ''}
                </th>
                <th className="px-3 py-2 font-medium">检测时间</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <ProxyRow
                  key={p.id}
                  proxy={p}
                  result={p.checks?.[targetKey]}
                  busy={Boolean(checking[`${p.id}|${targetKey}`])}
                  onCheck={() => void checkProxy(p.id, targetKey)}
                  onEdit={() => setForm({ open: true, editing: p })}
                  onDelete={() => void removeWithConfirm([p.id], `确定删除代理「${p.name}」?`)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form.open && (
        <ProxyFormModal proxy={form.editing} onClose={() => setForm({ open: false })} />
      )}
      {importOpen && (
        <ProxyImportModal
          onClose={() => setImportOpen(false)}
          onImported={(ids) => void checkProxies(ids, targetKey)}
          targetLabel={targetLabel}
        />
      )}
    </div>
  )
}

function ProxyRow({
  proxy: p,
  result: r,
  busy,
  onCheck,
  onEdit,
  onDelete
}: {
  proxy: ProxyEntry
  result?: ProxyCheckResult
  busy: boolean
  onCheck: () => void
  onEdit: () => void
  onDelete: () => void
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    window.api.clipboard.writeText(proxyUrl(p))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  const tone = latencyTone(r?.latencyMs)
  return (
    <tr className="group border-t border-[var(--panel-border)] hover:bg-[var(--content-bg)]">
      <td className="max-w-[200px] px-3 py-2">
        <div className="truncate font-medium text-[var(--text-dark)]" title={p.name}>
          {p.name}
        </div>
        {p.remark && (
          <div className="truncate text-xs text-[var(--text-muted)]" title={p.remark}>
            {p.remark}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <span className="rounded bg-[var(--content-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
          {PROXY_TYPE_LABEL[p.type]}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-[var(--text-dark)]">
        <span className="inline-flex items-center gap-1">
          {p.host}:{p.port}
          {(p.username || p.password) && (
            <Lock size={11} className="text-[var(--text-muted)]" aria-label="需要认证" />
          )}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-xs">{r?.ok ? r.exitIp : ''}</td>
      <td className="max-w-[220px] px-3 py-2">
        {r?.ok && (
          <>
            <div className="truncate text-xs text-[var(--text-dark)]" title={regionText(r)}>
              {flagEmoji(r.countryCode) ||
                (r.countryCode && (
                  <span className="mr-1 rounded bg-[var(--content-bg)] px-1 font-mono text-[10px] font-semibold text-[var(--text-muted)]">
                    {r.countryCode.toUpperCase()}
                  </span>
                ))}{' '}
              {regionText(r) || '未知'}
            </div>
            {r.isp && (
              <div className="truncate text-[11px] text-[var(--text-muted)]" title={r.isp}>
                {r.isp}
              </div>
            )}
          </>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {busy ? (
          <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />
        ) : !r ? (
          <span className="text-[var(--text-muted)]">未检测</span>
        ) : r.ok ? (
          <span
            className={`font-medium ${TONE_CLASS[tone]}`}
            title={`连到代理 ${r.connectMs ?? '?'}ms,经代理完成一次 HTTPS 请求 ${r.latencyMs}ms`}
          >
            {r.latencyMs}ms
          </span>
        ) : (
          <span className="font-medium text-[var(--danger)]" title={r.error}>
            失败
            <span className="ml-1 block max-w-[180px] truncate text-[11px] font-normal">
              {r.error}
            </span>
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{r ? ago(r.checkedAt) : ''}</td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
          <IconBtn title="检测" onClick={onCheck} disabled={busy}>
            <Activity size={13} />
          </IconBtn>
          <IconBtn title={copied ? '已复制' : '复制代理链接'} onClick={copy}>
            <Copy size={13} className={copied ? 'text-emerald-600' : ''} />
          </IconBtn>
          <IconBtn title="编辑" onClick={onEdit}>
            <Pencil size={13} />
          </IconBtn>
          <IconBtn title="删除" onClick={onDelete} danger>
            <Trash2 size={13} />
          </IconBtn>
        </div>
      </td>
    </tr>
  )
}

function IconBtn({
  title,
  onClick,
  disabled,
  danger,
  children
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md p-1.5 disabled:opacity-40 ${
        danger
          ? 'text-[var(--danger)] hover:bg-red-50'
          : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]'
      }`}
    >
      {children}
    </button>
  )
}

const Label = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">{children}</label>
)

function ProxyFormModal({
  proxy,
  onClose
}: {
  proxy?: ProxyEntry
  onClose: () => void
}): React.ReactElement {
  const addProxies = useVaultStore((s) => s.addProxies)
  const updateProxy = useVaultStore((s) => s.updateProxy)
  const [link, setLink] = useState('')
  const [name, setName] = useState(proxy?.name ?? '')
  const [type, setType] = useState<ProxyType>(proxy?.type ?? 'http')
  const [host, setHost] = useState(proxy?.host ?? '')
  const [port, setPort] = useState(proxy ? String(proxy.port) : '')
  const [username, setUsername] = useState(proxy?.username ?? '')
  const [password, setPassword] = useState(proxy?.password ?? '')
  const [remark, setRemark] = useState(proxy?.remark ?? '')
  const [error, setError] = useState('')

  const applyLink = (v: string): void => {
    setLink(v)
    const p = parseProxyLine(v, type)
    if (!p) return
    setType(p.type)
    setHost(p.host)
    setPort(String(p.port))
    setUsername(p.username ?? '')
    setPassword(p.password ?? '')
    if (!name) setName(p.name)
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const portNum = Number(port)
    if (!host.trim()) return setError('请填写代理地址')
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      return setError('端口需为 1-65535 的整数')
    const payload: NewProxy = {
      name: name.trim() || `${host.trim()}:${portNum}`,
      type,
      host: host.trim(),
      port: portNum,
      username: username || undefined,
      password: password || undefined,
      remark: remark.trim() || undefined
    }
    try {
      if (proxy) await updateProxy(proxy.id, payload)
      else await addProxies([payload])
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={submit} className="card max-h-[90vh] w-[460px] overflow-y-auto p-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-dark)]">
          {proxy ? '编辑代理' : '添加代理'}
        </h2>

        {!proxy && (
          <>
            <Label>粘贴代理链接(可选,自动填写下方字段)</Label>
            <input
              className="input mb-3 font-mono text-xs"
              placeholder="socks5://user:pass@1.2.3.4:1080"
              value={link}
              onChange={(e) => applyLink(e.target.value)}
            />
          </>
        )}

        <Label>名称</Label>
        <input
          className="input mb-3"
          value={name}
          placeholder="留空则使用 地址:端口"
          onChange={(e) => setName(e.target.value)}
        />

        <div className="mb-3 grid grid-cols-[120px_1fr_96px] gap-2">
          <div>
            <Label>类型</Label>
            <Select value={type} onChange={(v) => setType(v as ProxyType)} options={TYPE_OPTIONS} />
          </div>
          <div>
            <Label>地址</Label>
            <input
              className="input font-mono text-xs"
              value={host}
              placeholder="1.2.3.4"
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
          <div>
            <Label>端口</Label>
            <input
              className="input font-mono text-xs"
              value={port}
              inputMode="numeric"
              placeholder="1080"
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <Label>用户名(可选)</Label>
            <input
              className="input"
              value={username}
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <Label>密码(可选)</Label>
            <input
              type="password"
              className="input"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <Label>备注(可选)</Label>
        <input className="input mb-3" value={remark} onChange={(e) => setRemark(e.target.value)} />

        {error && <p className="mb-2 text-xs text-[var(--danger)]">{error}</p>}

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

function ProxyImportModal({
  onClose,
  onImported,
  targetLabel
}: {
  onClose: () => void
  onImported: (ids: string[]) => void
  targetLabel: string
}): React.ReactElement {
  const existing = useVaultStore((s) => s.proxies)
  const addProxies = useVaultStore((s) => s.addProxies)
  const [text, setText] = useState('')
  const [defaultType, setDefaultType] = useState<ProxyType>('http')
  const [checkAfter, setCheckAfter] = useState(true)
  const [busy, setBusy] = useState(false)

  const { items, badLines } = useMemo(() => parseProxyLines(text, defaultType), [text, defaultType])
  // 去重:与已有代理或本次前面的行重复的跳过。
  const fresh = useMemo(() => {
    const out: NewProxy[] = []
    for (const p of items) {
      if (existing.some((e) => sameProxy(e, p)) || out.some((o) => sameProxy(o, p))) continue
      out.push(p)
    }
    return out
  }, [items, existing])
  const dupes = items.length - fresh.length

  const submit = async (): Promise<void> => {
    if (fresh.length === 0) return
    setBusy(true)
    try {
      const added = await addProxies(fresh)
      if (checkAfter) onImported(added.map((p) => p.id))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="card flex max-h-[90vh] w-[560px] flex-col p-6">
        <h2 className="mb-1 text-lg font-semibold text-[var(--text-dark)]">批量导入代理</h2>
        <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
          每行一个,支持:
          <code className="mx-1">socks5://user:pass@ip:port</code>
          <code className="mx-1">http://ip:port</code>
          <code className="mx-1">ip:port</code>
          <code className="mx-1">ip:port:user:pass</code>
          <code className="mx-1">user:pass@ip:port</code>,行尾 <code>#名称</code> 作为名称。
        </p>
        <textarea
          className="input mb-3 h-56 font-mono text-xs"
          placeholder={'socks5://u:p@1.2.3.4:1080 #香港-01\n5.6.7.8:3128'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--text-muted)]">未写协议的行按</span>
          <div className="w-28">
            <Select
              value={defaultType}
              onChange={(v) => setDefaultType(v as ProxyType)}
              options={TYPE_OPTIONS}
            />
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--text-dark)]">
            <input
              type="checkbox"
              checked={checkAfter}
              onChange={(e) => setCheckAfter(e.target.checked)}
            />
            导入后在{targetLabel}上检测
          </label>
        </div>
        <div className="mb-3 text-xs text-[var(--text-muted)]">
          可导入 <b className="text-[var(--text-dark)]">{fresh.length}</b> 个
          {dupes > 0 && `,${dupes} 个重复已跳过`}
          {badLines.length > 0 && (
            <span className="text-[var(--danger)]">
              ,无法识别的行:{badLines.slice(0, 12).join('、')}
              {badLines.length > 12 && ' …'}
            </span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={fresh.length === 0 || busy}
            className="btn-primary disabled:opacity-50"
          >
            导入 {fresh.length > 0 ? fresh.length : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
