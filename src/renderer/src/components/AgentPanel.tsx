import { isValidElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
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
  FileText,
  Laptop,
  ArrowRightLeft,
  ArrowDown,
  AlertCircle
} from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import {
  useAgentStore,
  EMPTY_AGENT_SESSION,
  type AgentStatus,
  type TransferMeta
} from '../store/useAgentStore'
import { formatBytes } from '../lib/agentTransfer'
import { AGENT_MODES, modeInfo, type AgentMode } from '../lib/agentPermissions'
import {
  buildSystemPrompt,
  buildAgentTools,
  buildLocalTarget,
  localTargetName,
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
import type {
  Attachment,
  ChatMessage,
  ToolCall,
  LlmSettingsPublic,
  AgentConversationMeta
} from '@shared/types'

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
  // send / stop 归 Composer,resolveCall / answerQuestion / approvePlan 归各张卡片自己订阅。
  // store 上的 action 引用是稳定的,下沉之后面板不必再把回调当 props 往下传 —— 内联箭头函数
  // 每次渲染都是新引用,会让下面所有的 memo 全线失效。
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
    // 本机(宿主机)目标始终可用,排在末尾;先预占其名字,同名终端 tab 自动去重为 #2。
    const local = buildLocalTarget()
    seen.set(local.name, 1)
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
        host: hosts.find((h) => h.id === tab.hostId)?.label ?? tab.title,
        // 文件传输要用这些字段建自己的 SFTP / containerFs 会话。
        hostId: tab.hostId,
        containerId: tab.containerId,
        dockerCmd: tab.dockerCmd
      })
    }
    resolved.push(local)
    setTargets(sessionId, resolved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionId,
    JSON.stringify(attachedIds),
    JSON.stringify(terminalTabs.map((t) => t.id + t.title))
  ])

  const currentTargets = targets ?? []

  const [settings, setSettings] = useState<LlmSettingsPublic | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [docPreview, setDocPreview] = useState<Attachment | null>(null)
  const [convs, setConvs] = useState<AgentConversationMeta[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  // 用户主动上滚之后就不再强制吸底。既修掉「流式输出时滚不上去」的老毛病,
  // 也省掉每个 token 一次的 scrollHeight 读取 —— 那是一次强制同步 layout。
  const stickToBottom = useRef(true)

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
  //
  // 拆成三段是有意为之。原先整块挂在 `session.streamingText` 上,等于每来一个 token 就重建一遍
  // 系统提示、把工具定义 JSON.stringify 一次、再逐字符扫一遍**全部**历史消息 —— O(全会话字符)
  // 乘以出词速度。现在只有第三段随 token 变,而它只扫当前这一条回复。
  const targetKey = currentTargets.map((t) => t.name).join('|')
  const overhead = useMemo(() => {
    const sysText = buildSystemPrompt(currentTargets, mode)
    const tools = buildAgentTools(currentTargets, mode)
    return estimateTokens(sysText) + estimateTokens(JSON.stringify(tools))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, mode])
  const historyTokens = useMemo(() => estimateMessagesTokens(session.messages), [session.messages])
  const usage = useMemo(() => {
    const used = overhead + historyTokens + estimateTokens(session.streamingText)
    const window = activeModel?.contextWindow ?? guessContextWindow(activeModel?.name)
    return {
      used,
      window,
      overhead,
      msgs: historyTokens,
      messageCount: session.messages.length
    }
  }, [
    overhead,
    historyTokens,
    session.streamingText,
    session.messages.length,
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

  const lastMessages = useRef(session.messages)
  useEffect(() => {
    const grew = lastMessages.current !== session.messages
    lastMessages.current = session.messages
    if (!stickToBottom.current) return undefined
    const el = scrollRef.current
    if (!el) return undefined
    el.scrollTop = el.scrollHeight
    // content-visibility 下,视口外的行先按 contain-intrinsic-size 估高,浏览器实测到真实
    // 高度后 scrollHeight 才会修正。消息列表本身变化时(打开历史会话、新增一条)补一帧,
    // 保证真的落到底;流式的每个 token 不走这条,免得白白多一次强制 layout。
    if (!grew) return undefined
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [session.messages, session.streamingText, session.runningIds])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])

  // 发消息时无条件回到底部,否则用户上滚看旧内容后发一条,新消息会落在视野外。
  const stickNow = useCallback((): void => {
    stickToBottom.current = true
  }, [])

  const pickModel = (providerId: string, modelId: string, modelName: string): void => {
    window.api.llm.setActive(providerId, modelId)
    setSettings((s) => (s ? { ...s, activeProviderId: providerId, activeModelId: modelId } : s))
    setActiveModel(providerId, modelName)
  }

  // tool_call_id → 结果文本。原先每张卡片都 messages.find() 线性扫一遍全表,
  // 长会话下是 O(消息数 × 工具调用数),且每次渲染重来;建一次表后查询降到 O(1)。
  const results = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of session.messages) {
      if (m.role === 'tool' && m.tool_call_id) map.set(m.tool_call_id, m.content)
    }
    return map
  }, [session.messages])

  const interactive = session.status === 'idle' || session.status === 'awaiting'

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
          终端未连接,SSH 命令将无法执行(本机命令仍可用)。
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
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

          {/*
            消息是纯追加的,数组元素引用一旦产生就不再变,所以索引 key 是稳定的,
            memo 也能靠 `message` 的引用相等直接命中。传下去的每个 prop 都刻意做成
            「基本类型或稳定引用」:流式期间只有 streamingText 在变,这些 prop 全都不变,
            于是 189 条历史消息一条都不会重新渲染 —— 更不会重新解析 Markdown。
          */}
          {session.messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <UserRow
                  key={i}
                  sessionId={sessionId}
                  message={m}
                  disabled={session.status !== 'idle' || !configured}
                  onPreviewImage={setPreview}
                  onPreviewDoc={setDocPreview}
                  onReAsk={stickNow}
                />
              )
            }
            if (m.role === 'assistant') {
              return (
                <AssistantRow
                  key={i}
                  sessionId={sessionId}
                  message={m}
                  results={results}
                  // 只有真正带工具调用 / 传输的行才关心这两份实时状态,其余行拿到 undefined,
                  // 于是执行状态翻转、传输进度刷新时它们照样不重渲染。
                  runningIds={m.tool_calls?.length ? session.runningIds : undefined}
                  transferMeta={
                    m.tool_calls?.some((tc) => tc.function.name === 'transfer_file')
                      ? session.transferMeta
                      : undefined
                  }
                  fallbackTarget={currentTargets[0]?.name}
                  showTarget={currentTargets.length > 1}
                  interactive={interactive}
                />
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

      {/*
        输入框连同它的草稿 / 附件状态整体下沉到 Composer。之前 `input` 和消息列表同住一个
        组件,敲一个字符就要把全部历史消息重渲染一遍(中文输入法下一个汉字还要乘以几次
        composition 事件)。拆开之后按键只会重渲染 Composer 自己。
      */}
      <Composer
        sessionId={sessionId}
        status={session.status}
        configured={configured}
        usage={usage}
        mode={mode}
        onModeChange={setMode}
        settings={settings}
        activeModelLabel={activeModel ? activeModel.name : '选择模型'}
        onPickModel={pickModel}
        onManageProviders={() => setShowSettings(true)}
        terminals={terminalTabs.map((t) => ({
          id: t.id,
          title: t.title,
          host: hosts.find((h) => h.id === t.hostId)?.label ?? t.title
        }))}
        attachedIds={attachedIds}
        onAttach={(tid) => attach(sessionId, tid)}
        onDetach={(tid) => detach(sessionId, tid)}
        onPreviewImage={setPreview}
        onPreviewDoc={setDocPreview}
        onSubmit={stickNow}
      />

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

interface ContextUsage {
  used: number
  window: number
  overhead: number
  msgs: number
  messageCount: number
}

/**
 * 输入区(草稿 + 附件 + 底部工具条)。刻意做成独立组件:草稿状态只住在这里,
 * 敲键盘不会惊动上面的消息列表。它自己每次按键都会重渲染,但内部没有 Markdown,
 * 代价是常数级的。
 */
function Composer({
  sessionId,
  status,
  configured,
  usage,
  mode,
  onModeChange,
  settings,
  activeModelLabel,
  onPickModel,
  onManageProviders,
  terminals,
  attachedIds,
  onAttach,
  onDetach,
  onPreviewImage,
  onPreviewDoc,
  onSubmit
}: {
  sessionId: string
  status: AgentStatus
  configured: boolean
  usage: ContextUsage
  mode: AgentMode
  onModeChange: (m: AgentMode) => void
  settings: LlmSettingsPublic | null
  activeModelLabel: string
  onPickModel: (providerId: string, modelId: string, modelName: string) => void
  onManageProviders: () => void
  terminals: { id: string; title: string; host: string }[]
  attachedIds: string[]
  onAttach: (id: string) => void
  onDetach: (id: string) => void
  onPreviewImage: (src: string) => void
  onPreviewDoc: (a: Attachment) => void
  /** 发送前通知面板把滚动重新吸到底部。 */
  onSubmit: () => void
}): React.ReactElement {
  const send = useAgentStore((s) => s.send)
  const stop = useAgentStore((s) => s.stop)
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [docs, setDocs] = useState<Attachment[]>([])
  const [extracting, setExtracting] = useState(0)
  const [attachError, setAttachError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
    if ((!text && images.length === 0 && docs.length === 0) || status !== 'idle') return
    if (!configured) {
      onManageProviders()
      return
    }
    setInput('')
    setImages([])
    setDocs([])
    setAttachError('')
    onSubmit()
    send(sessionId, text, images, docs)
  }

  return (
    /* Claude-style input box: textarea + bottom toolbar (mode + model + send) */
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
                  onClick={() => onPreviewImage(src)}
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
                onOpen={() => onPreviewDoc(a)}
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
        {attachError && <div className="px-3 pt-2 text-xs text-[var(--danger)]">{attachError}</div>}
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
          placeholder={status === 'idle' ? '输入消息…(可粘贴 / 拖入图片、文档)' : '处理中…'}
          disabled={status !== 'idle'}
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
            disabled={status !== 'idle'}
            title="添加图片或文档(PDF / docx / 文本)"
            className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)] disabled:opacity-40"
          >
            <Paperclip size={13} className="text-[var(--accent)]" />
            附件
          </button>
          <ModeSelector mode={mode} onChange={onModeChange} />
          <ModelSelector
            settings={settings}
            activeLabel={activeModelLabel}
            onPick={onPickModel}
            onManage={onManageProviders}
          />
          <TargetSelector
            selfId={sessionId}
            terminals={terminals}
            attachedIds={attachedIds}
            onAttach={onAttach}
            onDetach={onDetach}
          />
          <div className="flex-1" />
          <ContextMeter usage={usage} />
          {status === 'streaming' || status === 'running' ? (
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
                status !== 'idle' ||
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
  )
}

function ContextMeter({ usage }: { usage: ContextUsage }): React.ReactElement {
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
          目标 {count + 1}
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
          {/* 本机(宿主机)目标:始终可用,不可取消 */}
          <div className="flex select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm">
            <Check size={14} className="shrink-0 text-[var(--accent)]" />
            <Laptop size={13} className="shrink-0 text-[var(--accent)]" />
            <div className="min-w-0 flex-1 truncate text-[var(--text-dark)]">
              {localTargetName()}
            </div>
            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">始终可用</span>
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
    /* 具名 group:裸 `group` 会被消息行外层那个 `group` 一起命中(group-hover 编译出来是
       后代选择器),结果鼠标停在消息任意位置,整条消息里每个代码块的复制按钮都会亮。 */
    <div className="group/code relative my-2">
      <button
        type="button"
        onClick={copy}
        title={copied ? '已复制' : '复制'}
        className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-1 text-[11px] text-[#d4d4d4] opacity-0 transition hover:bg-white/20 group-hover/code:opacity-100"
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

// 提升到模块作用域。原先这两个对象在每次 Markdown 渲染时重新构造 —— 一个新数组
// 加二十多个新闭包,纯属白扔;放在这里让它们成为真正的常量。
const MD_PLUGINS = [remarkGfm]

const MD_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-3 border-b border-[var(--panel-border)] pb-1 text-base font-semibold">
      {children}
    </h1>
  ),
  h2: ({ children }) => <h2 className="mb-1 mt-3 text-[0.95rem] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-sm font-semibold">{children}</h3>,
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2 text-sm font-semibold text-[var(--text-muted)]">{children}</h4>
  ),
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-[var(--text-muted)]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-[var(--text-muted)]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed [&>ul]:my-1 [&>ol]:my-1">{children}</li>,
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
}

/**
 * 一段渲染好的 Markdown 气泡。
 *
 * memo 在这里是整个优化的地基:react-markdown 自身**没有任何记忆化**(v10 的 lib/index.js
 * 里连一个 memo 都没有),每渲染一次就要完整跑一遍 remark 解析 → mdast → hast → React
 * 元素树。而 `text` 是个字符串,浅比较天然正确 —— 已经流完的消息内容永不再变,于是它们
 * 从此一次都不会被重新解析。实测 100 条历史消息的全量重解析约 84ms/次,memo 之后归零。
 */
const Markdown = memo(function Markdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="selectable max-w-[92%] self-start break-words rounded-2xl rounded-bl-sm bg-[var(--content-bg)] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--text-dark)] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

const QuestionCard = memo(function QuestionCard({
  sessionId,
  tc,
  answer,
  disabled
}: {
  sessionId: string
  tc: ToolCall
  answer?: string
  disabled?: boolean
}): React.ReactElement {
  const answerQuestion = useAgentStore((s) => s.answerQuestion)
  const [custom, setCustom] = useState('')
  // 参数解析下沉到卡片内部并 memo 住:放在父组件里就成了「每次渲染 JSON.parse 一遍」。
  const { question, options } = useMemo(() => parseAsk(tc), [tc])
  const onAnswer = (ans: string): void => answerQuestion(sessionId, tc, ans)
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
})

const PlanCard = memo(function PlanCard({
  sessionId,
  tc,
  result,
  disabled
}: {
  sessionId: string
  tc: ToolCall
  result?: string
  disabled?: boolean
}): React.ReactElement {
  const approvePlan = useAgentStore((s) => s.approvePlan)
  const answerQuestion = useAgentStore((s) => s.answerQuestion)
  const { title, plan } = useMemo(() => {
    try {
      const a = JSON.parse(tc.function.arguments || '{}')
      return { title: a.title as string | undefined, plan: String(a.plan ?? '') }
    } catch {
      return { title: undefined, plan: tc.function.arguments }
    }
  }, [tc])
  const onApprove = (runMode: AgentMode): void => approvePlan(sessionId, tc, runMode)
  const onRevise = (): void =>
    answerQuestion(
      sessionId,
      tc,
      '用户暂不执行,希望调整方案。请询问需要修改的地方或据此改进,仍处于计划模式。'
    )
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
})

/** One endpoint line of a transfer card: icon + target name + path. */
function TransferEndpoint({ name, path }: { name: string; path: string }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-[var(--accent)]">
        {name === localTargetName() ? <Laptop size={10} /> : <Server size={10} />}
        {name}
      </span>
      <span className="selectable truncate font-mono text-xs text-[var(--text-dark)]" title={path}>
        {path}
      </span>
    </div>
  )
}

const TransferCard = memo(function TransferCard({
  sessionId,
  tc,
  meta,
  result,
  running
}: {
  sessionId: string
  tc: ToolCall
  meta?: TransferMeta
  result?: string
  running: boolean
}): React.ReactElement {
  const resolveCall = useAgentStore((s) => s.resolveCall)
  const onApprove = (): void => {
    resolveCall(sessionId, tc, true)
  }
  const onReject = (): void => {
    resolveCall(sessionId, tc, false)
  }
  const isNote =
    result !== undefined && (result.startsWith('用户已拒绝') || result.startsWith('【计划模式】'))
  const failed = result !== undefined && result.startsWith('[传输失败]')
  const notRun = result !== undefined && result.startsWith('传输未执行')
  const p = meta?.progress
  const pct = p && p.totalBytes > 0 ? Math.min(100, (p.doneBytes / p.totalBytes) * 100) : 0

  const scope = ((): string => {
    if (meta?.planning) return '正在统计待传输文件…'
    if (meta?.plan === null) return '大小未知(容器内不预先扫描)'
    if (meta?.plan)
      return `共 ${meta.plan.totalFiles} 个文件 · ${formatBytes(meta.plan.totalBytes)}`
    return ''
  })()

  return (
    <div className="self-start w-[92%] overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <ArrowRightLeft size={13} className="text-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--text-muted)]">建议传输文件</span>
      </div>

      {meta && (
        <div className="flex flex-col gap-1 px-2.5 py-2">
          <TransferEndpoint name={meta.srcName} path={meta.srcPath} />
          <div className="flex items-center gap-1 pl-0.5 text-[10px] text-[var(--text-muted)]">
            <ArrowDown size={11} />
            传输到
          </div>
          <TransferEndpoint name={meta.dstName} path={meta.dstPath} />
          {scope && (
            <div className="flex items-center gap-1.5 pt-0.5 text-[11px] text-[var(--text-muted)]">
              {meta.planning && <Loader2 size={10} className="animate-spin" />}
              {scope}
            </div>
          )}
        </div>
      )}

      {result === undefined ? (
        <div className="border-t border-[var(--panel-border)] px-2.5 py-1.5">
          {running ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Loader2 size={12} className="animate-spin" />
                {p?.phase === 'scan' ? '扫描中…' : '传输中…'}
                {p && p.totalFiles > 0 && (
                  <span className="ml-auto tabular-nums">
                    {p.doneFiles}/{p.totalFiles} · {formatBytes(p.doneBytes)}
                    {p.totalBytes > 0 && ` / ${formatBytes(p.totalBytes)}`}
                  </span>
                )}
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-[var(--nav-bg-hover)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {p?.currentPath && (
                <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                  {p.currentPath}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onApprove}
                className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                <ArrowRightLeft size={11} />
                传输
              </button>
              <button
                onClick={onReject}
                className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs hover:bg-[var(--nav-bg-hover)]"
              >
                <X size={11} />
                拒绝
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-[var(--panel-border)] px-2.5 py-2">
          {isNote || notRun ? (
            <div className="text-xs text-[var(--text-muted)]">{result}</div>
          ) : (
            <div className="flex items-start gap-1.5 text-xs text-[var(--text-dark)]">
              {failed ? (
                <AlertCircle size={12} className="mt-0.5 shrink-0 text-red-600" />
              ) : (
                <Check size={12} className="mt-0.5 shrink-0 text-green-600" />
              )}
              <span className="selectable">{result}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

const ToolCard = memo(function ToolCard({
  sessionId,
  tc,
  fallbackTarget,
  showTarget,
  result,
  running
}: {
  sessionId: string
  tc: ToolCall
  /** 模型省略 target 时落到哪个终端(即 targets[0] 的名字)。 */
  fallbackTarget?: string
  /** 只有一个可用目标时不必显示目标标签。 */
  showTarget: boolean
  result?: string
  running: boolean
}): React.ReactElement {
  const resolveCall = useAgentStore((s) => s.resolveCall)
  const command = useMemo(() => parseCommand(tc), [tc])
  const parsedTarget = useMemo(() => parseTargetName(tc), [tc])
  const target = showTarget ? (parsedTarget ?? fallbackTarget) : undefined
  const onApprove = (): void => {
    resolveCall(sessionId, tc, true)
  }
  const onReject = (): void => {
    resolveCall(sessionId, tc, false)
  }
  const isNote =
    result !== undefined && (result.startsWith('用户已拒绝') || result.startsWith('【计划模式】'))
  return (
    <div className="self-start w-[92%] overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <Terminal size={13} className="text-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--text-muted)]">建议执行命令</span>
        {target && (
          <span className="ml-auto flex items-center gap-1 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
            {target === localTargetName() ? <Laptop size={10} /> : <Server size={10} />}
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
})

/*
 * ── 消息行 ─────────────────────────────────────────────────────────────────────
 *
 * `content-visibility: auto` 让浏览器跳过视口外消息的 layout 与 paint,`contain-intrinsic-size`
 * 里的 `auto` 关键字则让它记住这一行上次真实测得的高度,避免滚动条乱跳。这一层管的是「画」,
 * memo 管的是「算」,两者缺一不可 —— 只加 CSS 的话 Markdown 照样在解析,只是没画出来。
 */
const ROW_CV = '[content-visibility:auto] [contain-intrinsic-size:auto_120px]'

const UserRow = memo(function UserRow({
  sessionId,
  message,
  disabled,
  onPreviewImage,
  onPreviewDoc,
  onReAsk
}: {
  sessionId: string
  message: ChatMessage
  disabled: boolean
  onPreviewImage: (src: string) => void
  onPreviewDoc: (a: Attachment) => void
  onReAsk: () => void
}): React.ReactElement {
  const send = useAgentStore((s) => s.send)
  return (
    <div className={`group flex flex-col items-end ${ROW_CV}`}>
      {message.images?.length ? (
        <div className="mb-1 flex max-w-[88%] flex-wrap justify-end gap-1.5">
          {message.images.map((src, k) => (
            <img
              key={k}
              src={src}
              alt=""
              onClick={() => onPreviewImage(src)}
              className="max-h-32 cursor-zoom-in rounded-lg border border-[var(--panel-border)] object-cover"
            />
          ))}
        </div>
      ) : null}
      {message.attachments?.length ? (
        <div className="mb-1 flex max-w-[88%] flex-wrap justify-end gap-1.5">
          {message.attachments.map((a) => (
            <DocChip key={a.id} a={a} onOpen={() => onPreviewDoc(a)} />
          ))}
        </div>
      ) : null}
      {message.content && (
        <div className="selectable max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
          {message.content}
        </div>
      )}
      <div className="mt-0.5 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <MsgAction
          icon={Copy}
          title="复制"
          onClick={() => window.api.clipboard.writeText(message.content)}
        />
        <MsgAction
          icon={RotateCcw}
          title="重问"
          disabled={disabled}
          onClick={() => {
            onReAsk()
            send(sessionId, message.content, message.images, message.attachments)
          }}
        />
      </div>
    </div>
  )
})

const AssistantRow = memo(function AssistantRow({
  sessionId,
  message,
  results,
  runningIds,
  transferMeta,
  fallbackTarget,
  showTarget,
  interactive
}: {
  sessionId: string
  message: ChatMessage
  results: Map<string, string>
  runningIds?: string[]
  transferMeta?: Record<string, TransferMeta>
  fallbackTarget?: string
  showTarget: boolean
  interactive: boolean
}): React.ReactElement {
  const hasText = message.content.trim().length > 0
  return (
    <div className={`group flex flex-col gap-2 ${ROW_CV}`}>
      {hasText && <Markdown text={message.content} />}
      {message.tool_calls?.map((tc) => {
        const result = results.get(tc.id)
        const running = runningIds?.includes(tc.id) ?? false
        if (tc.function.name === 'ask_user') {
          return (
            <QuestionCard
              key={tc.id}
              sessionId={sessionId}
              tc={tc}
              answer={result}
              disabled={!interactive}
            />
          )
        }
        if (tc.function.name === 'present_plan') {
          return (
            <PlanCard
              key={tc.id}
              sessionId={sessionId}
              tc={tc}
              result={result}
              disabled={!interactive}
            />
          )
        }
        if (tc.function.name === 'transfer_file') {
          return (
            <TransferCard
              key={tc.id}
              sessionId={sessionId}
              tc={tc}
              meta={transferMeta?.[tc.id]}
              result={result}
              running={running}
            />
          )
        }
        return (
          <ToolCard
            key={tc.id}
            sessionId={sessionId}
            tc={tc}
            fallbackTarget={fallbackTarget}
            showTarget={showTarget}
            result={result}
            running={running}
          />
        )
      })}
      {hasText && (
        <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
          <MsgAction
            icon={Copy}
            title="复制"
            onClick={() => window.api.clipboard.writeText(message.content)}
          />
        </div>
      )}
    </div>
  )
})
