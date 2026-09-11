import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Copy, Save, Check, History, RefreshCw, Clock, Play } from 'lucide-react'
import { Select } from './ui/Select'
import { buildLogsCommand, LOG_TAIL_CHOICES } from '../lib/dockerContainers'
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
  readOnly,
  initialLang,
  sftpSessionId,
  containerFsSessionId,
  remotePath,
  fileKey,
  fileName,
  localPath,
  logTarget,
  logDockerCmd
}: {
  content?: string
  execCommand?: string
  sourceSessionId?: string
  /** 容器日志 tab:命令由行数/时间戳选项现算,工具栏也随之多出这几个控件。 */
  logTarget?: string
  logDockerCmd?: string
  /** 只读模式:内容不可编辑,工具栏只保留刷新/复制。 */
  readOnly?: boolean
  initialLang?: string
  sftpSessionId?: string
  /** 容器文件后端(docker exec/cp)的会话 id;与 sftpSessionId 互斥。 */
  containerFsSessionId?: string
  remotePath?: string
  fileKey?: string
  fileName?: string
  localPath?: string
}): React.ReactElement {
  const isSftp = !!(sftpSessionId && remotePath && fileKey)
  const isCfs = !!(containerFsSessionId && remotePath && fileKey)
  const isLocal = !!localPath
  // 容器日志 tab:命令不是固定的 execCommand,而是由下面的行数/时间戳选项现算。
  const isLog = !!(logTarget && logDockerCmd && sourceSessionId)
  // sftp 与容器后端共用同一套「远程文件 + 版本历史」逻辑,只是读写走不同 API。
  const remoteRead = (): Promise<string> =>
    isCfs
      ? window.api.containerFs.readFile(containerFsSessionId as string, remotePath as string)
      : window.api.sftp.readFile(sftpSessionId as string, remotePath as string)
  const remoteWrite = (text: string): Promise<void> =>
    isCfs
      ? window.api.containerFs.writeFile(containerFsSessionId as string, remotePath as string, text)
      : window.api.sftp.writeFile(sftpSessionId as string, remotePath as string, text)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  // Always points at the latest save() so the Monaco Ctrl+S command isn't stale.
  const saveRef = useRef<() => void>(() => {})
  const [language, setLanguage] = useState(
    initialLang || (isSftp || isCfs || isLocal ? guessLanguage(fileName) : 'plaintext')
  )
  const [value, setValue] = useState(
    content ?? (execCommand || isLog || isSftp || isCfs || isLocal ? '正在加载...' : '')
  )
  const [loading, setLoading] = useState(!!execCommand || isLog || isSftp || isCfs || isLocal)
  const [versions, setVersions] = useState<HistoryVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState(SERVER_VERSION)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  // 每次 +1 重跑 execCommand(刷新)
  const [execTick, setExecTick] = useState(0)
  // 容器日志:行数 / 时间戳 / 自动刷新(跟随)。命令据此现算,改选项即重新拉取。
  const [logTail, setLogTail] = useState<number | 'all'>(1000)
  const [logTimestamps, setLogTimestamps] = useState(false)
  const [logAuto, setLogAuto] = useState(false)
  const effectiveCommand = isLog
    ? buildLogsCommand(logDockerCmd as string, logTarget as string, {
        tail: logTail,
        timestamps: logTimestamps
      })
    : execCommand
  const isExec = !!(effectiveCommand && sourceSessionId)

  // 自动刷新:每 3s 重跑一次命令(刷新逻辑与手动刷新完全一致,末尾自动滚到底)。
  useEffect(() => {
    if (!isLog || !logAuto) return
    const t = setInterval(() => setExecTick((n) => n + 1), 3000)
    return () => clearInterval(t)
  }, [isLog, logAuto])

  // exec-result mode
  useEffect(() => {
    if (!effectiveCommand || !sourceSessionId) return
    let cancelled = false
    window.api.ssh
      .exec(sourceSessionId, effectiveCommand)
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
  }, [effectiveCommand, sourceSessionId, execTick])

  // 只读的命令输出(日志)加载后滚到末尾。value 落到 Monaco model 是异步的,故延后一拍。
  useEffect(() => {
    if (!isExec || !readOnly || loading) return
    const t = window.setTimeout(() => {
      const ed = editorRef.current
      const lines = ed?.getModel()?.getLineCount()
      if (ed && lines) ed.revealLine(lines)
    }, 0)
    return () => window.clearTimeout(t)
  }, [value, isExec, readOnly, loading])

  // sftp / 容器模式: read remote content + load history versions
  useEffect(() => {
    if (!isSftp && !isCfs) return
    let cancelled = false
    remoteRead()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSftp, isCfs, sftpSessionId, containerFsSessionId, remotePath, fileKey])

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
      const text = await remoteRead()
      setValue(text)
    } else {
      const text = await window.api.history.read(fileKey as string, id)
      setValue(text)
    }
  }

  const save = async (): Promise<void> => {
    if (loading || readOnly) return
    if (isSftp || isCfs) {
      const ok = await window.api.dialog.confirm({
        message: isCfs ? `是否将修改保存到容器?` : `是否将修改保存到服务器?`,
        detail: remotePath,
        confirmLabel: isCfs ? '保存到容器' : '保存到服务器',
        cancelLabel: '否'
      })
      if (!ok) return
      const text = currentText()
      try {
        await remoteWrite(text)
        await window.api.history.save(fileKey as string, text, fileName)
        const v = await window.api.history.list(fileKey as string)
        setVersions(v)
        setSelectedVersion(SERVER_VERSION)
        flashStatus(isCfs ? '已保存到容器' : '已保存到服务器')
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
    { value: SERVER_VERSION, label: isCfs ? '容器当前版本' : '服务器当前版本' },
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
        {(isSftp || isCfs) && (
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
        {isLog && (
          <div className="flex items-center gap-1.5">
            <div className="w-24">
              <Select
                value={String(logTail)}
                onChange={(v) => {
                  setLoading(true)
                  setLogTail(v === 'all' ? 'all' : Number(v))
                }}
                options={LOG_TAIL_CHOICES.map((c) => ({
                  value: String(c.value),
                  label: c.label
                }))}
                className="h-8 !py-0 text-xs"
              />
            </div>
            <button
              onClick={() => {
                setLoading(true)
                setLogTimestamps((v) => !v)
              }}
              title="在每行前显示时间戳(docker logs -t)"
              className={`btn-secondary h-8 !py-0 text-xs ${
                logTimestamps ? '!text-[var(--accent)]' : ''
              }`}
            >
              <Clock size={14} />
              时间戳
            </button>
            <button
              onClick={() => setLogAuto((v) => !v)}
              title="每 3 秒重新拉取一次日志"
              className={`btn-secondary h-8 !py-0 text-xs ${
                logAuto ? '!text-[var(--accent)]' : ''
              }`}
            >
              <Play size={14} />
              {logAuto ? '跟随中' : '自动刷新'}
            </button>
          </div>
        )}
        {statusMsg && <span className="text-xs text-[var(--accent)]">{statusMsg}</span>}
        {readOnly && <span className="text-xs text-[var(--text-muted)]">只读</span>}
        {isExec && (
          <button
            onClick={() => {
              setLoading(true)
              setExecTick((n) => n + 1)
            }}
            disabled={loading}
            className="btn-secondary h-8 !py-0 text-xs disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? '刷新中' : '刷新'}
          </button>
        )}
        <button onClick={copyAll} className="btn-secondary h-8 !py-0 text-xs">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? '已复制' : '复制全部'}
        </button>
        {!readOnly && (
          <button onClick={save} className="btn-primary h-8 !py-0 text-xs">
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? '已保存' : isSftp ? '保存到服务器' : isCfs ? '保存到容器' : '保存'}
          </button>
        )}
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
            readOnly: loading || !!readOnly,
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
