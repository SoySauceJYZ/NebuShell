import { isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Settings,
  Send,
  Play,
  X,
  Terminal,
  Loader2,
  Check,
  Trash2,
  ChevronDown,
  ShieldCheck,
  Cpu,
  History,
  SquarePen,
  MessageSquare,
  Server,
  Copy,
  RotateCcw,
  CircleHelp,
  ClipboardList,
  Square,
  Gauge,
  Paperclip,
  FileText
} from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import { useAgentStore, EMPTY_AGENT_SESSION } from '../store/useAgentStore'
import { AGENT_MODES, modeInfo, type AgentMode } from '../lib/agentPermissions'
import {
  buildSystemPrompt,
  buildRunCommandTool,
  READ_COMMAND_OUTPUT_TOOL,
  READ_ATTACHMENT_TOOL,
  ASK_USER_TOOL,
  PRESENT_PLAN_TOOL,
  type AgentTarget
} from '../lib/agentTools'
import {
  estimateMessagesTokens,
  estimateTokens,
  guessContextWindow,
  formatTokens
} from '../lib/contextUsage'
import {
  fileToDataUrl,
  imageFilesFrom,
  imageFilesFromClipboard,
  MAX_ATTACHED_IMAGES
} from '../lib/images'
import {
  attachmentFullText,
  buildAttachment,
  docFilesFrom,
  docFilesFromClipboard,
  DOC_ACCEPT,
  MAX_ATTACHED_DOCS
} from '../lib/attachments'
import { AgentSettingsModal } from './AgentSettingsModal'
import type { Attachment, ToolCall, LlmSettingsPublic, AgentConversationMeta } from '@shared/types'

function docMeta(a: Attachment): string {
  const chars = a.chars < 1000 ? `${a.chars} 字` : `${(a.chars / 1000).toFixed(1)}k 字`
  return a.pages ? `${a.pages} 页 · ${chars}` : chars
}

/** 一枚文档附件的 chip:输入框里可删除,消息气泡上只读。 */
function DocChip({
  a,
  onOpen,
  onRemove
}: {
  a: Attachment
  onOpen: () => void
  onRemove?: () => void
}): React.ReactElement {
  return (
    <div className="group/doc relative">
      <button
        onClick={onOpen}
        title="查看提取出的文本"
        className="flex max-w-[220px] items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--nav-bg-hover)] px-2 py-1.5 text-left hover:border-[var(--accent)]"
      >
        <FileText size={16} className="shrink-0 text-[var(--accent)]" />
        <div className="min-w-0">
          <div className="truncate text-xs text-[var(--text-dark)]">{a.name}</div>
          <div className="truncate text-[10px] text-[var(--text-muted)]">
            {docMeta(a)}
            {a.truncated && ' · 已截断'}
          </div>
        </div>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          title="移除"
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--danger)] text-white opacity-0 transition group-hover/doc:opacity-100"
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

function parseCommand(call: ToolCall): string {
  try {
    return JSON.parse(call.function.arguments || '{}').command ?? ''
  } catch {
    return call.function.arguments
  }
}

function parseTargetName(call: ToolCall): string | undefined {
  try {
    return JSON.parse(call.function.arguments || '{}').target
  } catch {
    return undefined
  }
}

function parseAsk(call: ToolCall): { question: string; options: string[] } {
  try {
    const a = JSON.parse(call.function.arguments || '{}')
    return { question: a.question ?? '', options: Array.isArray(a.options) ? a.options : [] }
  } catch {
    return { question: call.function.arguments, options: [] }
  }
}

export function AgentPanel({
  sessionId,
  hostId,
  connected
}: {
  sessionId: string
  hostId: string
  connected: boolean
}): React.ReactElement {
  const hosts = useVaultStore((s) => s.hosts)
  const hostLabel = hosts.find((h) => h.id === hostId)?.label ?? null
  const tabs = useSessionStore((s) => s.tabs)
  const session = useAgentStore((s) => s.sessions[sessionId] ?? EMPTY_AGENT_SESSION)
  const attached = useAgentStore((s) => s.attachedBySession[sessionId])
  const targets = useAgentStore((s) => s.targetsBySession[sessionId])
  const send = useAgentStore((s) => s.send)
  const resolveCall = useAgentStore((s) => s.resolveCall)
  const answerQuestion = useAgentStore((s) => s.answerQuestion)
  const approvePlan = useAgentStore((s) => s.approvePlan)
  const stop = useAgentStore((s) => s.stop)
  const mode = useAgentStore((s) => s.mode)
  const setMode = useAgentStore((s) => s.setMode)
  const setActiveModel = useAgentStore((s) => s.setActiveModel)
  const bindHost = useAgentStore((s) => s.bindHost)
  const ensureSelf = useAgentStore((s) => s.ensureSelf)
  const attach = useAgentStore((s) => s.attach)
  const detach = useAgentStore((s) => s.detach)
  const setTargets = useAgentStore((s) => s.setTargets)
  const newConversation = useAgentStore((s) => s.newConversation)
  const openConversation = useAgentStore((s) => s.openConversation)

  // All open terminal tabs are candidate targets.
  const terminalTabs = tabs.filter((t) => t.kind === 'terminal')
  const attachedIds = attached ?? [sessionId]

  // Resolve attached terminals → target descriptors (name deduped, self first).
  useEffect(() => {
    ensureSelf(sessionId)
  }, [ensureSelf, sessionId])

  useEffect(() => {
    const ordered = [sessionId, ...attachedIds.filter((x) => x !== sessionId)]
    const seen = new Map<string, number>()
    const resolved: AgentTarget[] = []
    for (const tid of ordered) {
      const tab = terminalTabs.find((t) => t.id === tid)
      if (!tab) continue
      const base = tab.title
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      resolved.push({
        sessionId: tid,
        name: n === 1 ? base : `${base} #${n}`,
        host: hosts.find((h) => h.id === tab.hostId)?.label ?? tab.title
      })
    }
    setTargets(sessionId, resolved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionId,
    JSON.stringify(attachedIds),
    JSON.stringify(terminalTabs.map((t) => t.id + t.title))
  ])

  const currentTargets = targets ?? []
  const targetNameFor = (tc: ToolCall): string | undefined => {
    const t = parseTargetName(tc)
    if (t) return t
    return currentTargets[0]?.name
  }

  const [settings, setSettings] = useState<LlmSettingsPublic | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [docs, setDocs] = useState<Attachment[]>([])
  const [extracting, setExtracting] = useState(0)
  const [attachError, setAttachError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [docPreview, setDocPreview] = useState<Attachment | null>(null)
  const [convs, setConvs] = useState<AgentConversationMeta[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadConvs = (): void => {
    window.api.agentChat.list(hostId).then(setConvs)
  }

  useEffect(() => {
    bindHost(sessionId, hostId)
    loadConvs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hostId])

  // Refresh the list whenever we land on the empty state (new conversation).
  useEffect(() => {
    if (session.messages.length === 0) loadConvs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.messages.length])

  const activeProvider =
    settings?.providers.find((p) => p.id === settings.activeProviderId) ?? settings?.providers[0]
  const activeModel =
    activeProvider?.models.find((m) => m.id === settings?.activeModelId) ??
    activeProvider?.models[0]
  const configured = !!(activeProvider?.hasKey && activeModel)

  // 上下文用量估算:忠实反映实际发送给模型的内容(系统提示 + 工具定义 + 全部消息 + 流式中的回复)。
  const targetKey = currentTargets.map((t) => t.name).join('|')
  const usage = useMemo(() => {
    const sysText = buildSystemPrompt(currentTargets, mode)
    const tools =
      mode === 'plan'
        ? [
            buildRunCommandTool(currentTargets),
            READ_COMMAND_OUTPUT_TOOL,
            READ_ATTACHMENT_TOOL,
            ASK_USER_TOOL,
            PRESENT_PLAN_TOOL
          ]
        : [
            buildRunCommandTool(currentTargets),
            READ_COMMAND_OUTPUT_TOOL,
            READ_ATTACHMENT_TOOL,
            ASK_USER_TOOL
          ]
    const overhead = estimateTokens(sysText) + estimateTokens(JSON.stringify(tools))
    const msgs = estimateMessagesTokens(session.messages)
    const used = overhead + msgs + estimateTokens(session.streamingText)
    const window = activeModel?.contextWindow ?? guessContextWindow(activeModel?.name)
    return { used, window, overhead, msgs, messageCount: session.messages.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session.messages,
    session.streamingText,
    mode,
    targetKey,
    activeModel?.name,
    activeModel?.contextWindow
  ])

  const loadSettings = (): void => {
    window.api.llm.getSettings().then(setSettings)
  }
  useEffect(loadSettings, [])

  // Keep the store's active provider/model in sync so the chat call knows what to use.
  useEffect(() => {
    if (activeProvider && activeModel) setActiveModel(activeProvider.id, activeModel.name)
  }, [activeProvider?.id, activeModel?.id, setActiveModel])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [session.messages, session.streamingText, session.runningIds])

  const pickModel = (providerId: string, modelId: string, modelName: string): void => {
    window.api.llm.setActive(providerId, modelId)
    setSettings((s) => (s ? { ...s, activeProviderId: providerId, activeModelId: modelId } : s))
    setActiveModel(providerId, modelName)
  }

  const resultFor = (id: string): string | undefined =>
    session.messages.find((m) => m.role === 'tool' && m.tool_call_id === id)?.content

  const addImages = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setAttachError('')
    const room = MAX_ATTACHED_IMAGES - images.length
    if (room <= 0) {
      setAttachError(`最多附加 ${MAX_ATTACHED_IMAGES} 张图片`)
      return
    }
    try {
      const urls = await Promise.all(files.slice(0, room).map(fileToDataUrl))
      setImages((prev) => [...prev, ...urls])
      if (files.length > room) setAttachError(`最多附加 ${MAX_ATTACHED_IMAGES} 张图片`)
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err))
    }
  }

  // 抽取可能要几秒(大 PDF),逐个处理并把失败的文件单独报出来,不因为一个坏文件丢掉其余的。
  const addDocs = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setAttachError('')
    const room = MAX_ATTACHED_DOCS - docs.length
    if (room <= 0) {
      setAttachError(`最多附加 ${MAX_ATTACHED_DOCS} 个文档`)
      return
    }
    const picked = files.slice(0, room)
    if (files.length > room) setAttachError(`最多附加 ${MAX_ATTACHED_DOCS} 个文档`)
    setExtracting((n) => n + picked.length)
    for (const file of picked) {
      try {
        const a = await buildAttachment(file)
        setDocs((prev) => [...prev, a])
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : String(err))
      } finally {
        setExtracting((n) => n - 1)
      }
    }
  }

  // 一次 drop/paste 里图片和文档可能同时出现,各走各的通道。
  const addFiles = (files: File[]): void => {
    void addImages(files.filter((f) => f.type.startsWith('image/')))
    void addDocs(files.filter((f) => !f.type.startsWith('image/')))
  }

  const handleSend = (): void => {
    const text = input.trim()
    if ((!text && images.length === 0 && docs.length === 0) || session.status !== 'idle') return
    if (!configured) {
      setShowSettings(true)
      return
    }
    setInput('')
    setImages([])
    setDocs([])
    setAttachError('')
    send(sessionId, text, images, docs)
  }

  // Re-ask: resend an earlier user message (with its images and documents) as a new turn.
  const reAsk = (text: string, imgs?: string[], atts?: Attachment[]): void => {
    if (session.status !== 'idle' || !configured) return
    send(sessionId, text, imgs, atts)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--panel-border)] px-3">
        <Terminal size={14} className="text-[var(--accent)]" />
        <span className="truncate text-sm font-medium text-[var(--text-dark)]">
          {hostLabel ?? '未连接'}
        </span>
        <div className="flex-1" />
        <DropdownMenu.Root onOpenChange={(open) => open && loadConvs()}>
          <DropdownMenu.Trigger asChild>
            <button
              title="切换会话"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
            >
              <History size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-[70] max-h-[320px] w-[260px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
            >
              {convs.length === 0 && (
                <div className="px-2.5 py-2 text-xs text-[var(--text-muted)]">暂无历史会话</div>
              )}
              {convs.map((c) => (
                <DropdownMenu.Item
                  key={c.id}
                  onSelect={() => void openConversation(sessionId, c.id)}
                  className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                >
                  <MessageSquare size={13} className="shrink-0 text-[var(--text-muted)]" />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                    {new Date(c.updatedAt).toLocaleDateString()}
                  </span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button
          onClick={() => newConversation(sessionId)}
          title="新建会话"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
        >
          <SquarePen size={14} />
        </button>
        <button
          onClick={() => setShowSettings(true)}
          title="模型供应商设置"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
        >
          <Settings size={14} />
        </button>
      </div>

      {!connected && (
        <div className="border-b border-[var(--panel-border)] bg-yellow-50 px-3 py-1.5 text-xs text-yellow-700">
          终端未连接,命令将无法执行。
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-3">
          {session.messages.length === 0 && (
            <div className="flex flex-col gap-3">
              <div className="mt-4 text-center text-xs leading-relaxed text-[var(--text-muted)]">
                {configured
                  ? `向智能体提问,或让它在「${hostLabel ?? '当前主机'}」上执行运维操作。`
                  : '尚未配置模型,点右上角齿轮添加供应商与模型。'}
              </div>
              {convs.length > 0 && (
                <div>
                  <div className="mb-1.5 px-1 text-xs font-semibold text-[var(--text-muted)]">
                    历史会话
                  </div>
                  <div className="flex flex-col gap-1">
                    {convs.map((c) => (
                      <div
                        key={c.id}
                        className="group flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--panel-border)] px-2.5 py-2 hover:border-[var(--accent)]"
                        onClick={() => void openConversation(sessionId, c.id)}
                      >
                        <MessageSquare size={14} className="shrink-0 text-[var(--accent)]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-[var(--text-dark)]">{c.title}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {new Date(c.updatedAt).toLocaleString()} · {c.messageCount} 条消息
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void window.api.agentChat.remove(hostId, c.id).then(loadConvs)
                          }}
                          title="删除会话"
                          className="rounded p-1 text-[var(--text-muted)] opacity-0 hover:bg-red-50 hover:text-[var(--danger)] group-hover:opacity-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {session.messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="group flex flex-col items-end">
                  {m.images?.length ? (
                    <div className="mb-1 flex max-w-[88%] flex-wrap justify-end gap-1.5">
                      {m.images.map((src, k) => (
                        <img
                          key={k}
                          src={src}
                          alt=""
                          onClick={() => setPreview(src)}
                          className="max-h-32 cursor-zoom-in rounded-lg border border-[var(--panel-border)] object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                  {m.attachments?.length ? (
                    <div className="mb-1 flex max-w-[88%] flex-wrap justify-end gap-1.5">
                      {m.attachments.map((a) => (
                        <DocChip key={a.id} a={a} onOpen={() => setDocPreview(a)} />
                      ))}
                    </div>
                  ) : null}
                  {m.content && (
                    <div className="selectable max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
                      {m.content}
                    </div>
                  )}
                  <div className="mt-0.5 flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <MsgAction
                      icon={Copy}
                      title="复制"
                      onClick={() => window.api.clipboard.writeText(m.content)}
                    />
                    <MsgAction
                      icon={RotateCcw}
                      title="重问"
                      disabled={session.status !== 'idle'}
                      onClick={() => reAsk(m.content, m.images, m.attachments)}
                    />
                  </div>
                </div>
              )
            }
            if (m.role === 'assistant') {
              return (
                <div key={i} className="group flex flex-col gap-2">
                  {m.content.trim() && <Markdown text={m.content} />}
                  {m.tool_calls?.map((tc) => {
                    if (tc.function.name === 'ask_user') {
                      const { question, options } = parseAsk(tc)
                      return (
                        <QuestionCard
                          key={tc.id}
                          question={question}
                          options={options}
                          answer={resultFor(tc.id)}
                          disabled={session.status !== 'idle' && session.status !== 'awaiting'}
                          onAnswer={(ans) => answerQuestion(sessionId, tc, ans)}
                        />
                      )
                    }
                    if (tc.function.name === 'present_plan') {
                      const a = (() => {
                        try {
                          return JSON.parse(tc.function.arguments || '{}')
                        } catch {
                          return { plan: tc.function.arguments }
                        }
                      })()
                      return (
                        <PlanCard
                          key={tc.id}
                          title={a.title}
                          plan={a.plan ?? ''}
                          result={resultFor(tc.id)}
                          disabled={session.status !== 'idle' && session.status !== 'awaiting'}
                          onApprove={(runMode) => approvePlan(sessionId, tc, runMode)}
                          onRevise={() =>
                            answerQuestion(
                              sessionId,
                              tc,
                              '用户暂不执行,希望调整方案。请询问需要修改的地方或据此改进,仍处于计划模式。'
                            )
                          }
                        />
                      )
                    }
                    return (
                      <ToolCard
                        key={tc.id}
                        command={parseCommand(tc)}
                        target={currentTargets.length > 1 ? targetNameFor(tc) : undefined}
                        result={resultFor(tc.id)}
                        running={session.runningIds.includes(tc.id)}
                        onApprove={() => resolveCall(sessionId, tc, true)}
                        onReject={() => resolveCall(sessionId, tc, false)}
                      />
                    )
                  })}
                  {m.content.trim() && (
                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                      <MsgAction
                        icon={Copy}
                        title="复制"
                        onClick={() => window.api.clipboard.writeText(m.content)}
                      />
                    </div>
                  )}
                </div>
              )
            }
            return null
          })}

          {session.streamingText.trim() && <Markdown text={session.streamingText} />}
          {session.status === 'streaming' && !session.streamingText && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <Loader2 size={13} className="animate-spin" />
              思考中...
            </div>
          )}
          {session.error && (
            <div className="text-xs text-[var(--danger)]">错误: {session.error}</div>
          )}
        </div>
      </div>

      {/* Claude-style input box: textarea + bottom toolbar (mode + model + send) */}
      <div className="shrink-0 p-2">
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDragOver(true)
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            const files = [...imageFilesFrom(e.dataTransfer), ...docFilesFrom(e.dataTransfer)]
            if (files.length === 0) return
            e.preventDefault()
            setDragOver(false)
            addFiles(files)
          }}
          className={`rounded-xl border bg-[var(--panel-bg)] focus-within:border-[var(--accent)] ${
            dragOver
              ? 'border-[var(--accent)] bg-[var(--accent-soft)]/30'
              : 'border-[var(--panel-border)]'
          }`}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pt-2">
              {images.map((src, i) => (
                <div key={i} className="group/img relative">
                  <img
                    src={src}
                    alt=""
                    onClick={() => setPreview(src)}
                    className="h-14 w-14 cursor-zoom-in rounded-lg border border-[var(--panel-border)] object-cover"
                  />
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, k) => k !== i))}
                    title="移除"
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--danger)] text-white opacity-0 transition group-hover/img:opacity-100"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {(docs.length > 0 || extracting > 0) && (
            <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
              {docs.map((a, i) => (
                <DocChip
                  key={a.id}
                  a={a}
                  onOpen={() => setDocPreview(a)}
                  onRemove={() => setDocs((prev) => prev.filter((_, k) => k !== i))}
                />
              ))}
              {extracting > 0 && (
                <div className="flex items-center gap-1.5 px-1 text-xs text-[var(--text-muted)]">
                  <Loader2 size={13} className="animate-spin" />
                  正在解析 {extracting} 个文件…
                </div>
              )}
            </div>
          )}
          {attachError && (
            <div className="px-3 pt-2 text-xs text-[var(--danger)]">{attachError}</div>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = [
                ...imageFilesFromClipboard(e.clipboardData),
                ...docFilesFromClipboard(e.clipboardData)
              ]
              if (files.length === 0) return
              // 剪贴板里同时带图和 HTML 时,阻止浏览器再把图片的 <img> 标签粘成文字。
              e.preventDefault()
              addFiles(files)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={2}
            placeholder={
              session.status === 'idle' ? '输入消息…(可粘贴 / 拖入图片、文档)' : '处理中…'
            }
            disabled={session.status !== 'idle'}
            className="max-h-40 w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
          />
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
            <input
              ref={fileRef}
              type="file"
              accept={`image/*,${DOC_ACCEPT}`}
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={session.status !== 'idle'}
              title="添加图片或文档(PDF / docx / 文本)"
              className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)] disabled:opacity-40"
            >
              <Paperclip size={13} className="text-[var(--accent)]" />
              附件
            </button>
            <ModeSelector mode={mode} onChange={setMode} />
            <ModelSelector
              settings={settings}
              activeLabel={activeModel ? activeModel.name : '选择模型'}
              onPick={pickModel}
              onManage={() => setShowSettings(true)}
            />
            <TargetSelector
              selfId={sessionId}
              terminals={terminalTabs.map((t) => ({
                id: t.id,
                title: t.title,
                host: hosts.find((h) => h.id === t.hostId)?.label ?? t.title
              }))}
              attachedIds={attachedIds}
              onAttach={(tid) => attach(sessionId, tid)}
              onDetach={(tid) => detach(sessionId, tid)}
            />
            <div className="flex-1" />
            <ContextMeter usage={usage} />
            {session.status === 'streaming' || session.status === 'running' ? (
              <button
                onClick={() => stop(sessionId)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--danger)] text-white hover:opacity-90"
                title="停止"
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={
                  session.status !== 'idle' ||
                  extracting > 0 ||
                  (!input.trim() && images.length === 0 && docs.length === 0)
                }
                className="btn-primary h-8 w-8 shrink-0 !p-0 disabled:opacity-40"
                title="发送"
              >
                <Send size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-black/70 p-8"
        >
          <img src={preview} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}

      {docPreview && (
        <div
          onClick={() => setDocPreview(null)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-full w-[720px] max-w-full flex-col rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)]"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--panel-border)] px-3 py-2">
              <FileText size={14} className="text-[var(--accent)]" />
              <span className="truncate text-sm text-[var(--text-dark)]">{docPreview.name}</span>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">
                {docMeta(docPreview)}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => setDocPreview(null)}
                className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
              >
                <X size={14} />
              </button>
            </div>
            <pre className="selectable flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs text-[var(--text-dark)]">
              {attachmentFullText(docPreview)}
            </pre>
            {docPreview.truncated && (
              <div className="shrink-0 border-t border-[var(--panel-border)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                模型只直接看到前 {docPreview.preview.length}{' '}
                字,其余部分由它按需检索(read_attachment)。
              </div>
            )}
          </div>
        </div>
      )}

      {showSettings && (
        <AgentSettingsModal onClose={() => setShowSettings(false)} onSaved={loadSettings} />
      )}
    </div>
  )
}

function ContextMeter({
  usage
}: {
  usage: { used: number; window: number; overhead: number; msgs: number; messageCount: number }
}): React.ReactElement {
  const { used, window, overhead, msgs, messageCount } = usage
  const pct = window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0
  const level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok'
  const textColor =
    level === 'danger'
      ? 'text-[var(--danger)]'
      : level === 'warn'
        ? 'text-amber-500'
        : 'text-[var(--text-muted)]'
  const barColor =
    level === 'danger'
      ? 'bg-[var(--danger)]'
      : level === 'warn'
        ? 'bg-amber-500'
        : 'bg-[var(--accent)]'
  const title =
    `上下文估算 ≈ ${used.toLocaleString()} / ${window.toLocaleString()} tokens(${pct}%)\n` +
    `· 系统提示 + 工具 ≈ ${overhead.toLocaleString()}\n` +
    `· 对话 ≈ ${msgs.toLocaleString()}(${messageCount} 条消息)\n` +
    `估算值,实际以模型分词为准`
  return (
    <div
      title={title}
      className="flex items-center gap-1.5 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs"
    >
      <Gauge size={13} className={textColor} />
      <div className="h-1 w-6 overflow-hidden rounded-full bg-[var(--panel-border)]">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`tabular-nums ${level === 'ok' ? 'text-[var(--text-dark)]' : textColor}`}>
        ≈{formatTokens(used)}
      </span>
      <span className="text-[10px] text-[var(--text-muted)]">/{formatTokens(window)}</span>
    </div>
  )
}

function ModeSelector({
  mode,
  onChange
}: {
  mode: AgentMode
  onChange: (m: AgentMode) => void
}): React.ReactElement {
  const info = modeInfo(mode)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]">
          <ShieldCheck size={13} className="text-[var(--accent)]" />
          {info.label}
          <ChevronDown size={12} className="text-[var(--text-muted)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="top"
          sideOffset={6}
          className="z-[70] w-[248px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
        >
          {AGENT_MODES.map((m) => (
            <DropdownMenu.Item
              key={m.id}
              onSelect={() => onChange(m.id)}
              className="flex cursor-pointer select-none items-start gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
            >
              <Check
                size={14}
                className={`mt-0.5 shrink-0 ${m.id === mode ? 'text-[var(--accent)]' : 'text-transparent'}`}
              />
              <div className="min-w-0">
                <div className="font-medium text-[var(--text-dark)]">{m.label}</div>
                <div className="text-xs leading-snug text-[var(--text-muted)]">{m.description}</div>
              </div>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ModelSelector({
  settings,
  activeLabel,
  onPick,
  onManage
}: {
  settings: LlmSettingsPublic | null
  activeLabel: string
  onPick: (providerId: string, modelId: string, modelName: string) => void
  onManage: () => void
}): React.ReactElement {
  const providers = settings?.providers ?? []
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex max-w-[150px] items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]">
          <Cpu size={13} className="shrink-0 text-[var(--accent)]" />
          <span className="truncate">{activeLabel}</span>
          <ChevronDown size={12} className="shrink-0 text-[var(--text-muted)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="top"
          sideOffset={6}
          className="z-[70] max-h-[320px] w-[240px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
        >
          {providers.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-[var(--text-muted)]">还没有供应商</div>
          )}
          {providers.map((p) => (
            <div key={p.id}>
              <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {p.name}
              </div>
              {p.models.length === 0 && (
                <div className="px-2.5 py-1 text-xs text-[var(--text-muted)]">(无模型)</div>
              )}
              {p.models.map((m) => {
                const active =
                  p.id === settings?.activeProviderId && m.id === settings?.activeModelId
                return (
                  <DropdownMenu.Item
                    key={m.id}
                    onSelect={() => onPick(p.id, m.id, m.name)}
                    className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                  >
                    <Check
                      size={13}
                      className={`shrink-0 ${active ? 'text-[var(--accent)]' : 'text-transparent'}`}
                    />
                    <span className="truncate font-mono text-xs">{m.label || m.name}</span>
                  </DropdownMenu.Item>
                )
              })}
            </div>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
          <DropdownMenu.Item
            onSelect={onManage}
            className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-[var(--accent)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
          >
            <Settings size={13} />
            管理供应商 / 模型
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function TargetSelector({
  selfId,
  terminals,
  attachedIds,
  onAttach,
  onDetach
}: {
  selfId: string
  terminals: { id: string; title: string; host: string }[]
  attachedIds: string[]
  onAttach: (id: string) => void
  onDetach: (id: string) => void
}): React.ReactElement {
  const count = attachedIds.filter((id) => terminals.some((t) => t.id === id)).length
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]">
          <Server size={13} className="text-[var(--accent)]" />
          终端 {count}
          <ChevronDown size={12} className="text-[var(--text-muted)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="top"
          sideOffset={6}
          className="z-[70] max-h-[320px] w-[260px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-[var(--text-muted)]">
            勾选让智能体可在这些终端执行命令
          </div>
          {terminals.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-[var(--text-muted)]">没有打开的终端</div>
          )}
          {terminals.map((t) => {
            const isSelf = t.id === selfId
            const checked = attachedIds.includes(t.id)
            return (
              <DropdownMenu.CheckboxItem
                key={t.id}
                checked={checked}
                disabled={isSelf}
                onSelect={(e) => {
                  e.preventDefault()
                  if (isSelf) return
                  checked ? onDetach(t.id) : onAttach(t.id)
                }}
                className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[disabled]:opacity-100 data-[highlighted]:bg-[var(--nav-bg-hover)]"
              >
                <Check
                  size={14}
                  className={`shrink-0 ${checked ? 'text-[var(--accent)]' : 'text-transparent'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--text-dark)]">
                    {t.title}
                    {isSelf && <span className="ml-1 text-[10px] text-[var(--accent)]">当前</span>}
                  </div>
                </div>
              </DropdownMenu.CheckboxItem>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MsgAction({
  icon: Icon,
  title,
  onClick,
  disabled
}: {
  icon: typeof Copy
  title: string
  onClick: () => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)] disabled:opacity-40"
    >
      <Icon size={12} />
      {title}
    </button>
  )
}

function nodeToText(node: React.ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join('')
  if (isValidElement(node)) {
    return nodeToText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

function CodeBlock({ children }: { children?: React.ReactNode }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    window.api.clipboard.writeText(nodeToText(children))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="group relative my-2">
      <button
        type="button"
        onClick={copy}
        title={copied ? '已复制' : '复制'}
        className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-1 text-[11px] text-[#d4d4d4] opacity-0 transition hover:bg-white/20 group-hover:opacity-100"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? '已复制' : '复制'}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-[#0f1117] p-3 text-[0.82em] leading-relaxed text-[#d4d4d4]">
        {children}
      </pre>
    </div>
  )
}

function Markdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="selectable max-w-[92%] self-start break-words rounded-2xl rounded-bl-sm bg-[var(--content-bg)] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--text-dark)] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-1.5 mt-3 border-b border-[var(--panel-border)] pb-1 text-base font-semibold">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1 mt-3 text-[0.95rem] font-semibold">{children}</h2>
          ),
          h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-sm font-semibold">{children}</h3>,
          h4: ({ children }) => (
            <h4 className="mb-1 mt-2 text-sm font-semibold text-[var(--text-muted)]">{children}</h4>
          ),
          p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-[var(--text-muted)]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-[var(--text-muted)]">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed [&>ul]:my-1 [&>ol]:my-1">{children}</li>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2 hover:decoration-[var(--accent)]"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="my-3 border-[var(--panel-border)]" />,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-[3px] border-[var(--accent)]/40 bg-black/[0.02] py-0.5 pl-3 text-[var(--text-muted)]">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-black/[0.04]">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-[var(--panel-border)] px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--panel-border)] px-2 py-1 align-top">{children}</td>
          ),
          code({ className, children, ...props }) {
            const inline = !className
            return inline ? (
              <code
                className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.82em] text-[var(--accent-hover)]"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code className="font-mono text-[0.85em]" {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function QuestionCard({
  question,
  options,
  answer,
  disabled,
  onAnswer
}: {
  question: string
  options: string[]
  answer?: string
  disabled?: boolean
  onAnswer: (answer: string) => void
}): React.ReactElement {
  const [custom, setCustom] = useState('')
  const answered = answer !== undefined
  return (
    <div className="self-start w-[92%] overflow-hidden rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)]/40">
      <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <CircleHelp size={13} className="text-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--accent)]">需要你确认</span>
      </div>
      <div className="selectable px-2.5 py-2 text-sm text-[var(--text-dark)]">{question}</div>
      {answered ? (
        <div className="flex items-center gap-1.5 border-t border-[var(--panel-border)] px-2.5 py-2 text-xs text-[var(--text-muted)]">
          <Check size={12} className="text-green-600" />
          你的选择:{answer}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 border-t border-[var(--panel-border)] p-2">
          {options.map((opt) => (
            <button
              key={opt}
              disabled={disabled}
              onClick={() => onAnswer(opt)}
              className="rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 py-1.5 text-left text-sm hover:border-[var(--accent)] disabled:opacity-40"
            >
              {opt}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) onAnswer(custom.trim())
              }}
              placeholder={options.length ? '或自行输入…' : '输入你的回答…'}
              disabled={disabled}
              className="input flex-1 py-1.5 text-sm"
            />
            <button
              onClick={() => custom.trim() && onAnswer(custom.trim())}
              disabled={disabled || !custom.trim()}
              className="btn-primary h-8 px-3 text-xs disabled:opacity-40"
            >
              回答
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanCard({
  title,
  plan,
  result,
  disabled,
  onApprove,
  onRevise
}: {
  title?: string
  plan: string
  result?: string
  disabled?: boolean
  onApprove: (runMode: AgentMode) => void
  onRevise: () => void
}): React.ReactElement {
  const done = result !== undefined
  const approved = result?.startsWith('用户已确认')
  const runModes = AGENT_MODES.filter((m) => m.id !== 'plan')
  return (
    <div className="self-start w-[92%] overflow-hidden rounded-xl border border-[var(--accent)]/50 bg-[var(--panel-bg)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] bg-[var(--accent-soft)]/40 px-2.5 py-1.5">
        <ClipboardList size={13} className="text-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--accent)]">{title || '执行方案'}</span>
      </div>
      <div className="selectable px-1">
        <Markdown text={plan} />
      </div>
      {done ? (
        <div className="flex items-center gap-1.5 border-t border-[var(--panel-border)] px-2.5 py-2 text-xs text-[var(--text-muted)]">
          <Check size={12} className="text-green-600" />
          {approved ? '已确认,开始执行' : '已退回修改'}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--panel-border)] p-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                disabled={disabled}
                className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
              >
                <Play size={12} />
                开始执行
                <ChevronDown size={12} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="top"
                align="start"
                sideOffset={6}
                className="z-[70] w-[240px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
              >
                {runModes.map((m) => (
                  <DropdownMenu.Item
                    key={m.id}
                    onSelect={() => onApprove(m.id)}
                    className="flex cursor-pointer select-none flex-col gap-0.5 rounded-md px-2.5 py-1.5 outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                  >
                    <span className="text-sm font-medium text-[var(--text-dark)]">{m.label}</span>
                    <span className="text-xs leading-snug text-[var(--text-muted)]">
                      {m.description}
                    </span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            disabled={disabled}
            onClick={onRevise}
            className="rounded-md border border-[var(--panel-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--nav-bg-hover)] disabled:opacity-40"
          >
            修改方案
          </button>
        </div>
      )}
    </div>
  )
}

function ToolCard({
  command,
  target,
  result,
  running,
  onApprove,
  onReject
}: {
  command: string
  target?: string
  result?: string
  running: boolean
  onApprove: () => void
  onReject: () => void
}): React.ReactElement {
  const isNote =
    result !== undefined && (result.startsWith('用户已拒绝') || result.startsWith('【计划模式】'))
  return (
    <div className="self-start w-[92%] overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <Terminal size={13} className="text-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--text-muted)]">建议执行命令</span>
        {target && (
          <span className="ml-auto flex items-center gap-1 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
            <Server size={10} />
            {target}
          </span>
        )}
      </div>
      <pre className="selectable overflow-x-auto px-2.5 py-2 font-mono text-xs text-[var(--text-dark)]">
        {command}
      </pre>
      {result === undefined ? (
        <div className="flex items-center gap-2 border-t border-[var(--panel-border)] px-2.5 py-1.5">
          {running ? (
            <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Loader2 size={12} className="animate-spin" />
              执行中…
            </span>
          ) : (
            <>
              <button
                onClick={onApprove}
                className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                <Play size={11} />
                执行
              </button>
              <button
                onClick={onReject}
                className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs hover:bg-[var(--nav-bg-hover)]"
              >
                <X size={11} />
                拒绝
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="border-t border-[var(--panel-border)]">
          {isNote ? (
            <div className="px-2.5 py-2 text-xs text-[var(--text-muted)]">{result}</div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 px-2.5 pt-1.5 text-xs text-[var(--text-muted)]">
                <Check size={12} className="text-green-600" />
                执行结果
              </div>
              <pre className="selectable max-h-56 overflow-auto px-2.5 py-2 font-mono text-xs text-[var(--text-dark)]">
                {result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
