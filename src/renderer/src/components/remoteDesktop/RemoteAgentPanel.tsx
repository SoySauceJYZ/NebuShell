import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Square, Plus, Settings, Check, Loader2, History } from 'lucide-react'
import type { ToolCall, LlmSettingsPublic, AgentConversationMeta } from '@shared/types'
import { AGENT_MODES, type AgentMode } from '../../lib/agentPermissions'
import { useRdAgentStore, type RdAgentBridge } from '../../store/useRdAgentStore'
import { AgentSettingsModal } from '../AgentSettingsModal'

interface Props {
  rdSessionId: string
  /** 历史落盘分区键(如 rd:<ip>)。 */
  peerKey: string
  /** 截图/注入/发文件桥;通道未就绪时为 null。 */
  bridge: RdAgentBridge | null
}

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments || '{}')
  } catch {
    return {}
  }
}

function describeAction(name: string, a: Record<string, unknown>): string {
  switch (name) {
    case 'move_mouse':
      return `移动鼠标到 (${a.x}, ${a.y})`
    case 'click':
      return `${a.button === 'right' ? '右键' : a.button === 'middle' ? '中键' : ''}点击 (${a.x}, ${a.y})`
    case 'double_click':
      return `双击 (${a.x}, ${a.y})`
    case 'type_text':
      return `键入文本:${String(a.text ?? '')}`
    case 'press_key':
      return `按组合键:${String(a.keys ?? '')}`
    case 'scroll':
      return `滚动 ${a.direction} @(${a.x}, ${a.y})`
    case 'wait':
      return `等待 ${a.seconds ?? 1}s`
    case 'transfer_file':
      return `发送文件:${String(a.path ?? '')}`
    case 'screenshot':
      return '重新截图'
    default:
      return name
  }
}

export function RemoteAgentPanel({ rdSessionId, peerKey, bridge }: Props): React.ReactElement {
  const store = useRdAgentStore()
  const session = store.sessions[rdSessionId]
  const [goal, setGoal] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<LlmSettingsPublic | null>(null)
  const [histOpen, setHistOpen] = useState(false)
  const [convs, setConvs] = useState<AgentConversationMeta[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  const loadModels = async (): Promise<void> => setSettings(await window.api.llm.getSettings())

  useEffect(() => {
    store.ensure(rdSessionId, peerKey)
    store.loadSettings()
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdSessionId, peerKey])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [session?.messages, session?.streamingText, session?.runningIds])

  if (!session) return <div className="min-h-0 flex-1" />

  const busy = session.status === 'streaming' || session.status === 'running'
  const send = (): void => {
    const g = goal.trim()
    if (!g || !bridge) return
    store.send(rdSessionId, bridge, g)
    setGoal('')
  }

  const resultFor = (id: string): string | undefined =>
    session.messages.find((m) => m.role === 'tool' && m.tool_call_id === id)?.content

  const pickModel = (value: string): void => {
    const [pid, mid] = value.split('::')
    const provider = settings?.providers.find((p) => p.id === pid)
    const model = provider?.models.find((m) => m.id === mid)
    if (provider && model) {
      window.api.llm.setActive(provider.id, model.id)
      store.setActiveModel(provider.id, model.name)
    }
  }
  const currentModelValue = `${store.activeProviderId ?? ''}::${
    settings?.providers
      .find((p) => p.id === store.activeProviderId)
      ?.models.find((m) => m.name === store.activeModel)?.id ?? ''
  }`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <Bot size={15} className="text-[var(--accent)]" />
        <span className="text-sm font-medium text-[var(--text-dark)]">智能体</span>
        <div className="relative ml-auto flex items-center gap-1">
          <button
            title="历史对话"
            onClick={async () => {
              if (!histOpen) setConvs(await store.listConvs(peerKey))
              setHistOpen((v) => !v)
            }}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <History size={15} />
          </button>
          {histOpen && (
            <div className="absolute right-0 top-8 z-20 max-h-64 w-56 overflow-y-auto rounded-md border border-[var(--panel-border)] bg-white py-1 shadow-lg">
              {convs.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-[var(--text-muted)]">暂无历史</div>
              )}
              {convs.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    store.openConv(rdSessionId, peerKey, c.id)
                    setHistOpen(false)
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-[11px] text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
                  title={c.title}
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
          <button
            title="新对话"
            onClick={() => store.reset(rdSessionId)}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <Plus size={15} />
          </button>
          <button
            title="模型设置"
            onClick={() => setShowSettings(true)}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {/* 模式 + 模型 */}
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <select
          value={store.mode}
          onChange={(e) => store.setMode(e.target.value as AgentMode)}
          className="rounded border border-[var(--panel-border)] bg-white px-1.5 py-1 text-[11px]"
          title="权限模式"
        >
          {AGENT_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={currentModelValue}
          onChange={(e) => pickModel(e.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--panel-border)] bg-white px-1.5 py-1 text-[11px]"
          title="模型"
        >
          {!settings?.providers.length && <option>未配置模型</option>}
          {settings?.providers.flatMap((p) =>
            p.models.map((m) => (
              <option key={`${p.id}::${m.id}`} value={`${p.id}::${m.id}`}>
                {p.name} · {m.label || m.name}
              </option>
            ))
          )}
        </select>
      </div>

      {/* 消息列表 */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
        {session.messages.length === 0 && (
          <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
            让智能体看被控机画面并替你操作。例如「打开记事本并输入 hello」。
          </p>
        )}
        {session.messages.map((m, idx) => {
          if (m.role === 'user') {
            return (
              <div key={idx} className="flex flex-col items-end gap-1">
                <div className="max-w-[92%] rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs text-[var(--text-dark)]">
                  {m.content.replace(/\n?\[screenshot[^\]]*\]/g, '')}
                </div>
                {m.images?.[0] && (
                  <img
                    src={m.images[0]}
                    alt="screenshot"
                    className="max-h-24 rounded border border-[var(--panel-border)]"
                  />
                )}
              </div>
            )
          }
          if (m.role === 'tool') return null // 结果并入对应卡片
          // assistant
          return (
            <div key={idx} className="space-y-2">
              {m.content && (
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-dark)]">
                  {m.content}
                </div>
              )}
              {m.tool_calls?.map((tc) => {
                const args = parseArgs(tc)
                const result = resultFor(tc.id)
                const name = tc.function.name
                if (name === 'ask_user')
                  return (
                    <QuestionCard
                      key={tc.id}
                      question={String(args.question ?? '')}
                      options={(args.options as string[]) ?? []}
                      result={result}
                      onAnswer={(t) => bridge && store.answer(rdSessionId, bridge, tc, t)}
                    />
                  )
                if (name === 'present_plan')
                  return (
                    <PlanCard
                      key={tc.id}
                      plan={String(args.plan ?? '')}
                      result={result}
                      onApprove={(mode) =>
                        bridge && store.approvePlan(rdSessionId, bridge, tc, mode)
                      }
                    />
                  )
                if (name === 'done')
                  return (
                    <div
                      key={tc.id}
                      className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700"
                    >
                      <Check size={13} /> {result || '已完成'}
                    </div>
                  )
                return (
                  <ActionCard
                    key={tc.id}
                    desc={describeAction(name, args)}
                    result={result}
                    running={session.runningIds.includes(tc.id)}
                    awaiting={session.status === 'awaiting' && !result}
                    onApprove={() => bridge && store.resolveAction(rdSessionId, bridge, tc, true)}
                    onReject={() => bridge && store.resolveAction(rdSessionId, bridge, tc, false)}
                  />
                )
              })}
            </div>
          )
        })}
        {session.status === 'streaming' && (
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-muted)]">
            {session.streamingText || '思考中…'}
          </div>
        )}
        {session.error && <div className="text-xs text-[var(--danger)]">{session.error}</div>}
      </div>

      {/* 输入 */}
      <div className="border-t border-[var(--panel-border)] p-2">
        {!bridge && (
          <p className="mb-1 text-[10px] text-[var(--text-muted)]">画面未就绪,连接稳定后可用。</p>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder="描述要在被控机上完成的任务…"
            className="min-h-0 flex-1 resize-none rounded-md border border-[var(--panel-border)] bg-white px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
          />
          {busy || session.status === 'awaiting' ? (
            <button
              onClick={() => store.stop(rdSessionId)}
              title="停止"
              className="rounded-md bg-[var(--danger)] p-2 text-white"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!goal.trim() || !bridge}
              title="发送"
              className="rounded-md bg-[var(--accent)] p-2 text-white disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <AgentSettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            loadModels()
            store.loadSettings()
          }}
        />
      )}
    </div>
  )
}

function ActionCard({
  desc,
  result,
  running,
  awaiting,
  onApprove,
  onReject
}: {
  desc: string
  result?: string
  running: boolean
  awaiting: boolean
  onApprove: () => void
  onReject: () => void
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 py-1.5 text-xs">
      <div className="text-[var(--text-dark)]">{desc}</div>
      {result ? (
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">{result}</div>
      ) : running ? (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <Loader2 size={11} className="animate-spin" /> 执行中…
        </div>
      ) : awaiting ? (
        <div className="mt-1.5 flex gap-2">
          <button
            onClick={onApprove}
            className="rounded bg-[var(--accent)] px-2 py-0.5 text-[11px] text-white"
          >
            执行
          </button>
          <button
            onClick={onReject}
            className="rounded border border-[var(--panel-border)] px-2 py-0.5 text-[11px]"
          >
            拒绝
          </button>
        </div>
      ) : null}
    </div>
  )
}

function QuestionCard({
  question,
  options,
  result,
  onAnswer
}: {
  question: string
  options: string[]
  result?: string
  onAnswer: (text: string) => void
}): React.ReactElement {
  const [txt, setTxt] = useState('')
  return (
    <div className="rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 py-2 text-xs">
      <div className="mb-1.5 text-[var(--text-dark)]">{question}</div>
      {result ? (
        <div className="text-[11px] text-[var(--text-muted)]">你的选择:{result}</div>
      ) : (
        <div className="space-y-1.5">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => onAnswer(o)}
              className="block w-full rounded border border-[var(--panel-border)] px-2 py-1 text-left hover:bg-[var(--nav-bg-hover)]"
            >
              {o}
            </button>
          ))}
          <div className="flex gap-1.5">
            <input
              value={txt}
              onChange={(e) => setTxt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && txt.trim() && onAnswer(txt.trim())}
              placeholder="或自行输入…"
              className="min-w-0 flex-1 rounded border border-[var(--panel-border)] px-2 py-1"
            />
            <button
              onClick={() => txt.trim() && onAnswer(txt.trim())}
              className="rounded bg-[var(--accent)] px-2 text-white"
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanCard({
  plan,
  result,
  onApprove
}: {
  plan: string
  result?: string
  onApprove: (mode: AgentMode) => void
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 py-2 text-xs">
      <div className="mb-1.5 whitespace-pre-wrap text-[var(--text-dark)]">{plan}</div>
      {result ? (
        <div className="text-[11px] text-[var(--text-muted)]">{result}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {AGENT_MODES.filter((m) => m.id !== 'plan').map((m) => (
            <button
              key={m.id}
              onClick={() => onApprove(m.id)}
              title={m.description}
              className="rounded bg-[var(--accent)] px-2 py-0.5 text-[11px] text-white"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
