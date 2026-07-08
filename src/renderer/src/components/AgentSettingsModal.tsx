import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
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

  const removeProvider = (id: string): void =>
    setProviders((ps) => ps.filter((p) => p.id !== id))

  const addModel = (pid: string): void =>
    updateProviderModels(pid, (models) => [...models, { id: uid(), name: '' }])

  const updateModel = (pid: string, mid: string, name: string): void =>
    updateProviderModels(pid, (models) =>
      models.map((m) => (m.id === mid ? { ...m, name } : m))
    )

  const removeModel = (pid: string, mid: string): void =>
    updateProviderModels(pid, (models) => models.filter((m) => m.id !== mid))

  const updateProviderModels = (
    pid: string,
    fn: (models: LlmModel[]) => LlmModel[]
  ): void => setProviders((ps) => ps.map((p) => (p.id === pid ? { ...p, models: fn(p.models) } : p)))

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
                  <button
                    onClick={() => addModel(p.id)}
                    className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                  >
                    <Plus size={12} />
                    添加模型
                  </button>
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

          <button
            onClick={addProvider}
            className="btn-secondary mt-3 w-full justify-center"
          >
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
