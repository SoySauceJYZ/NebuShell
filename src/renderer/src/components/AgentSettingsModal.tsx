import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, X, ListPlus, Check, Loader2, Search } from 'lucide-react'
import type { LlmModel } from '@shared/types'

interface EditProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string // blank = keep existing
  hasKey: boolean
  models: LlmModel[]
}

function uid(): string {
  return crypto.randomUUID()
}

/**
 * 「获取模型列表」下拉:点开时用供应商当前(未保存亦可)的 Base URL + Key 调 /models,
 * 列出返回的模型 id 供勾选。已添加的置灰打勾,再点即移除;顶部可过滤。
 */
function ModelPicker({
  provider,
  onToggle
}: {
  provider: EditProvider
  onToggle: (name: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const fetchModels = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const list = await window.api.llm.listModels({
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey
      })
      setIds(list)
      if (list.length === 0) setError('接口未返回任何模型')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const toggleOpen = (): void => {
    const next = !open
    setOpen(next)
    if (next && ids.length === 0 && !loading) void fetchModels()
  }

  const added = new Set(provider.models.map((m) => m.name.trim()).filter(Boolean))
  const shown = filter.trim()
    ? ids.filter((id) => id.toLowerCase().includes(filter.trim().toLowerCase()))
    : ids

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={toggleOpen}
        className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
      >
        <ListPlus size={12} />
        获取模型列表
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1.5 shadow-lg">
          <div className="mb-1 flex items-center gap-1.5 rounded-md border border-[var(--panel-border)] px-2">
            <Search size={12} className="text-[var(--text-muted)]" />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="过滤…"
              className="w-full bg-transparent py-1.5 text-xs outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-[var(--text-muted)]">
                <Loader2 size={13} className="animate-spin" />
                正在获取…
              </div>
            )}
            {!loading && error && (
              <div className="px-2 py-3 text-xs text-[var(--danger)]">
                {error}
                <button onClick={() => void fetchModels()} className="ml-1 underline">
                  重试
                </button>
              </div>
            )}
            {!loading &&
              !error &&
              shown.map((id) => {
                const on = added.has(id)
                return (
                  <button
                    key={id}
                    onClick={() => onToggle(id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-[var(--nav-bg-hover)]"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                        on
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                          : 'border-[var(--panel-border)]'
                      }`}
                    >
                      {on && <Check size={10} />}
                    </span>
                    <span className={`truncate ${on ? 'text-[var(--text-muted)]' : ''}`}>{id}</span>
                  </button>
                )
              })}
            {!loading && !error && shown.length === 0 && ids.length > 0 && (
              <div className="px-2 py-3 text-xs text-[var(--text-muted)]">无匹配</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function AgentSettingsModal({
  onClose,
  onSaved
}: {
  onClose: () => void
  onSaved: () => void
}): React.ReactElement {
  const [providers, setProviders] = useState<EditProvider[]>([])

  useEffect(() => {
    window.api.llm.getSettings().then((s) => {
      setProviders(
        s.providers.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          apiKey: '',
          hasKey: p.hasKey,
          models: p.models
        }))
      )
    })
  }, [])

  const updateProvider = (id: string, patch: Partial<EditProvider>): void =>
    setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const addProvider = (): void =>
    setProviders((ps) => [
      ...ps,
      { id: uid(), name: '新供应商', baseUrl: '', apiKey: '', hasKey: false, models: [] }
    ])

  const removeProvider = (id: string): void => setProviders((ps) => ps.filter((p) => p.id !== id))

  const addModel = (pid: string): void =>
    updateProviderModels(pid, (models) => [...models, { id: uid(), name: '' }])

  const updateModel = (pid: string, mid: string, name: string): void =>
    updateProviderModels(pid, (models) => models.map((m) => (m.id === mid ? { ...m, name } : m)))

  const removeModel = (pid: string, mid: string): void =>
    updateProviderModels(pid, (models) => models.filter((m) => m.id !== mid))

  // 从「获取模型列表」勾选:已存在同名则移除,否则新增 —— 即勾选/取消。
  const toggleModelByName = (pid: string, name: string): void =>
    updateProviderModels(pid, (models) => {
      const trimmed = name.trim()
      const idx = models.findIndex((m) => m.name.trim() === trimmed)
      if (idx !== -1) return models.filter((_, i) => i !== idx)
      return [...models, { id: uid(), name: trimmed }]
    })

  const updateProviderModels = (pid: string, fn: (models: LlmModel[]) => LlmModel[]): void =>
    setProviders((ps) => ps.map((p) => (p.id === pid ? { ...p, models: fn(p.models) } : p)))

  const handleSave = async (): Promise<void> => {
    const cleaned = providers.map((p) => ({
      id: p.id,
      name: p.name.trim() || '未命名',
      baseUrl: p.baseUrl.trim(),
      apiKey: p.apiKey, // blank keeps existing (merged in main)
      models: p.models
        .filter((m) => m.name.trim())
        .map((m) => ({ id: m.id, name: m.name.trim(), label: m.label }))
    }))
    await window.api.llm.setSettings({ providers: cleaned })
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="card flex max-h-[86vh] w-[560px] flex-col p-0">
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-5 py-3">
          <h2 className="text-base font-semibold text-[var(--text-dark)]">模型供应商</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {providers.length === 0 && (
            <div className="mb-3 text-center text-sm text-[var(--text-muted)]">
              还没有供应商,点下面「添加供应商」。
            </div>
          )}
          <div className="flex flex-col gap-3">
            {providers.map((p) => (
              <div key={p.id} className="rounded-xl border border-[var(--panel-border)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    className="input flex-1 font-medium"
                    value={p.name}
                    onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                    placeholder="供应商名称,如 DeepSeek"
                  />
                  <button
                    onClick={() => removeProvider(p.id)}
                    title="删除供应商"
                    className="rounded-md p-2 text-[var(--danger)] hover:bg-red-50"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <label className="mb-1 block text-xs text-[var(--text-muted)]">Base URL</label>
                <input
                  className="input mb-2"
                  value={p.baseUrl}
                  onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                />

                <label className="mb-1 block text-xs text-[var(--text-muted)]">API Key</label>
                <input
                  type="password"
                  className="input mb-2"
                  value={p.apiKey}
                  onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })}
                  placeholder={p.hasKey ? '已配置(留空则不修改)' : 'sk-...'}
                />

                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">模型</span>
                  <div className="flex items-center gap-3">
                    <ModelPicker provider={p} onToggle={(name) => toggleModelByName(p.id, name)} />
                    <button
                      onClick={() => addModel(p.id)}
                      className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                    >
                      <Plus size={12} />
                      添加模型
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {p.models.length === 0 && (
                    <div className="text-xs text-[var(--text-muted)]">暂无模型</div>
                  )}
                  {p.models.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <input
                        className="input flex-1 font-mono text-xs"
                        value={m.name}
                        onChange={(e) => updateModel(p.id, m.id, e.target.value)}
                        placeholder="deepseek-chat / gpt-4o-mini / qwen2.5 ..."
                      />
                      <button
                        onClick={() => removeModel(p.id, m.id)}
                        className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button onClick={addProvider} className="btn-secondary mt-3 w-full justify-center">
            <Plus size={15} />
            添加供应商
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--panel-border)] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            取消
          </button>
          <button onClick={handleSave} className="btn-primary">
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
