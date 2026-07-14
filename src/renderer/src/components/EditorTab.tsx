import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Copy, Save, Check, History } from 'lucide-react'
import { Select } from './ui/Select'
import type { HistoryVersion } from '@shared/types'

const LANG_OPTIONS = [
  { value: 'plaintext', label: '纯文本' },
  { value: 'shell', label: 'Shell' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'ini', label: 'INI/Conf' },
  { value: 'log', label: '日志' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'sql', label: 'SQL' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'xml', label: 'XML' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'cpp', label: 'C/C++' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' }
]

const EXT_LANG: Record<string, string> = {
  json: 'json',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  conf: 'ini',
  ini: 'ini',
  cfg: 'ini',
  toml: 'ini',
  env: 'ini',
  log: 'log',
  java: 'java',
  go: 'go',
  rs: 'rust',
  c: 'cpp',
  h: 'cpp',
  cpp: 'cpp',
  php: 'php',
  rb: 'ruby'
}

function guessLanguage(name?: string): string {
  if (!name) return 'plaintext'
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  const ext = lower.includes('.') ? (lower.split('.').pop() ?? '') : ''
  return EXT_LANG[ext] ?? 'plaintext'
}

const SERVER_VERSION = '__server__'

export function EditorTab({
  content,
  execCommand,
  sourceSessionId,
  initialLang,
  sftpSessionId,
  remotePath,
  fileKey,
  fileName,
  localPath
}: {
  content?: string
  execCommand?: string
  sourceSessionId?: string
  initialLang?: string
  sftpSessionId?: string
  remotePath?: string
  fileKey?: string
  fileName?: string
  localPath?: string
}): React.ReactElement {
  const isSftp = !!(sftpSessionId && remotePath && fileKey)
  const isLocal = !!localPath
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  // Always points at the latest save() so the Monaco Ctrl+S command isn't stale.
  const saveRef = useRef<() => void>(() => {})
  const [language, setLanguage] = useState(
    initialLang || (isSftp || isLocal ? guessLanguage(fileName) : 'plaintext')
  )
  const [value, setValue] = useState(
    content ?? (execCommand || isSftp || isLocal ? '正在加载...' : '')
  )
  const [loading, setLoading] = useState(!!execCommand || isSftp || isLocal)
  const [versions, setVersions] = useState<HistoryVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState(SERVER_VERSION)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  // exec-result mode
  useEffect(() => {
    if (!execCommand || !sourceSessionId) return
    let cancelled = false
    window.api.ssh
      .exec(sourceSessionId, execCommand)
      .then((out) => {
        if (!cancelled) setValue(out)
      })
      .catch((err) => {
        if (!cancelled) setValue(`[执行失败] ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [execCommand, sourceSessionId])

  // sftp mode: read remote content + load history versions
  useEffect(() => {
    if (!isSftp) return
    let cancelled = false
    window.api.sftp
      .readFile(sftpSessionId as string, remotePath as string)
      .then((text) => {
        if (!cancelled) setValue(text)
      })
      .catch((err) => {
        if (!cancelled) setValue(`[读取失败] ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    window.api.history.list(fileKey as string).then((v) => {
      if (!cancelled) setVersions(v)
    })
    return () => {
      cancelled = true
    }
  }, [isSftp, sftpSessionId, remotePath, fileKey])

  // local-file mode: read local content
  useEffect(() => {
    if (!isLocal) return
    let cancelled = false
    window.api.local
      .readFile(localPath as string)
      .then((text) => {
        if (!cancelled) setValue(text)
      })
      .catch((err) => {
        if (!cancelled) setValue(`[读取失败] ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isLocal, localPath])

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed
    // Ctrl/Cmd+S saves (to the server for remote files) instead of the browser default.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current()
    })
  }

  const currentText = (): string => editorRef.current?.getValue() ?? value

  const flashStatus = (msg: string): void => {
    setStatusMsg(msg)
    window.setTimeout(() => setStatusMsg(''), 2000)
  }

  const copyAll = (): void => {
    window.api.clipboard.writeText(currentText())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const selectVersion = async (id: string): Promise<void> => {
    setSelectedVersion(id)
    if (id === SERVER_VERSION) {
      const text = await window.api.sftp.readFile(sftpSessionId as string, remotePath as string)
      setValue(text)
    } else {
      const text = await window.api.history.read(fileKey as string, id)
      setValue(text)
    }
  }

  const save = async (): Promise<void> => {
    if (loading) return
    if (isSftp) {
      const ok = await window.api.dialog.confirm({
        message: `是否将修改保存到服务器?`,
        detail: remotePath,
        confirmLabel: '保存到服务器',
        cancelLabel: '否'
      })
      if (!ok) return
      const text = currentText()
      try {
        await window.api.sftp.writeFile(sftpSessionId as string, remotePath as string, text)
        await window.api.history.save(fileKey as string, text, fileName)
        const v = await window.api.history.list(fileKey as string)
        setVersions(v)
        setSelectedVersion(SERVER_VERSION)
        flashStatus('已保存到服务器')
      } catch (err) {
        flashStatus(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }
    if (isLocal) {
      const text = currentText()
      try {
        await window.api.local.writeFile(localPath as string, text)
        flashStatus('已保存')
      } catch (err) {
        flashStatus(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }
    // plain / exec mode: save to a local file
    const ext = language === 'plaintext' ? 'txt' : language
    const path = await window.api.file.saveText(`untitled.${ext}`, currentText())
    if (path) {
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    }
  }

  // Keep the Ctrl+S command bound to the current save() closure.
  useEffect(() => {
    saveRef.current = save
  })

  const versionOptions = [
    { value: SERVER_VERSION, label: '服务器当前版本' },
    ...versions.map((v) => ({ value: v.id, label: v.label }))
  ]

  return (
    <div className="flex h-full flex-col bg-[var(--panel-bg)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--panel-border)] px-3">
        <div className="w-32">
          <Select
            value={language}
            onChange={setLanguage}
            options={LANG_OPTIONS}
            className="h-8 !py-0 text-xs"
          />
        </div>
        {isSftp && (
          <div className="flex items-center gap-1.5">
            <History size={15} className="text-[var(--text-muted)]" />
            <div className="w-44">
              <Select
                value={selectedVersion}
                onChange={selectVersion}
                options={versionOptions}
                className="h-8 !py-0 text-xs"
              />
            </div>
          </div>
        )}
        <div className="flex-1" />
        {statusMsg && <span className="text-xs text-[var(--accent)]">{statusMsg}</span>}
        <button onClick={copyAll} className="btn-secondary h-8 !py-0 text-xs">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? '已复制' : '复制全部'}
        </button>
        <button onClick={save} className="btn-primary h-8 !py-0 text-xs">
          {saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? '已保存' : isSftp ? '保存到服务器' : '保存'}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          language={language}
          value={value}
          onChange={(v) => setValue(v ?? '')}
          onMount={handleMount}
          theme="vs"
          loading={<div className="p-4 text-sm text-[var(--text-muted)]">编辑器加载中...</div>}
          options={{
            fontSize: 13,
            fontFamily: 'Consolas, "Courier New", monospace',
            minimap: { enabled: true },
            readOnly: loading,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on'
          }}
        />
      </div>
    </div>
  )
}
