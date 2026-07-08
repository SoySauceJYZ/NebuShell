import { useEffect, useState } from 'react'
import { FileClock, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import type { HistoryDocument, HistoryVersion } from '@shared/types'

function guessLangByName(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  const ext = lower.includes('.') ? (lower.split('.').pop() ?? '') : ''
  const map: Record<string, string> = {
    json: 'json',
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    conf: 'ini',
    ini: 'ini',
    log: 'log',
    xml: 'xml',
    html: 'html'
  }
  return map[ext] ?? 'plaintext'
}

export function HistoryDocsView(): React.ReactElement {
  const hosts = useVaultStore((s) => s.hosts)
  const openTab = useSessionStore((s) => s.openTab)
  const [docs, setDocs] = useState<HistoryDocument[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [versions, setVersions] = useState<Record<string, HistoryVersion[]>>({})

  const refresh = (): void => {
    window.api.history.listAll().then(setDocs)
  }

  useEffect(() => {
    refresh()
  }, [])

  const hostLabel = (hostId: string): string =>
    hosts.find((h) => h.id === hostId)?.label ?? hostId ?? '未知主机'

  const toggle = async (doc: HistoryDocument): Promise<void> => {
    if (expanded === doc.fileKey) {
      setExpanded(null)
      return
    }
    setExpanded(doc.fileKey)
    if (!versions[doc.fileKey]) {
      const list = await window.api.history.list(doc.fileKey)
      setVersions((prev) => ({ ...prev, [doc.fileKey]: list }))
    }
  }

  const openVersion = async (doc: HistoryDocument, version: HistoryVersion): Promise<void> => {
    const text = await window.api.history.read(doc.fileKey, version.id)
    openTab({
      id: `editor-hist-${doc.fileKey}-${version.id}`,
      kind: 'editor',
      title: `${doc.fileName} @ ${version.label}`,
      editorContent: text,
      editorLang: guessLangByName(doc.fileName)
    })
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--text-dark)]">历史文档</h2>
        <button onClick={refresh} className="btn-secondary" title="刷新">
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      {docs.length === 0 && (
        <div className="mt-20 text-center text-sm text-[var(--text-muted)]">
          还没有历史文档。在 SFTP 里用编辑器打开文件并保存到服务器后,会在这里生成本地历史版本。
        </div>
      )}

      <div className="flex flex-col gap-2">
        {docs.map((doc) => {
          const open = expanded === doc.fileKey
          const vs = versions[doc.fileKey] ?? []
          return (
            <div key={doc.fileKey || doc.remotePath} className="card overflow-hidden">
              <button
                onClick={() => toggle(doc)}
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-[var(--nav-bg-hover)]"
              >
                {open ? (
                  <ChevronDown size={16} className="shrink-0 text-[var(--text-muted)]" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-[var(--text-muted)]" />
                )}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                  <FileClock size={16} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{doc.fileName}</div>
                  <div className="truncate text-xs text-[var(--text-muted)]">
                    {hostLabel(doc.hostId)} · {doc.remotePath}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-[var(--text-muted)]">
                  {doc.versionCount} 个版本
                </div>
              </button>

              {open && (
                <div className="border-t border-[var(--panel-border)] bg-[var(--content-bg)]/40 py-1">
                  {vs.length === 0 && (
                    <div className="px-4 py-2 text-xs text-[var(--text-muted)]">加载中...</div>
                  )}
                  {vs.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => openVersion(doc, v)}
                      className="flex w-full items-center gap-2 px-4 py-2 pl-14 text-left text-xs hover:bg-[var(--nav-bg-hover)]"
                      title="点击在编辑器中打开该版本"
                    >
                      <FileClock size={13} className="text-[var(--text-muted)]" />
                      <span className="font-mono">{v.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
