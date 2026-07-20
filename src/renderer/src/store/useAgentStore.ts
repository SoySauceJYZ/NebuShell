import { create } from 'zustand'
import type { Attachment, ChatMessage, ToolCall, TransferPlan, TransferProgress } from '@shared/types'
import { buildAgentTools, buildSystemPrompt, isLocalTarget, type AgentTarget } from '../lib/agentTools'
import {
  describeOutcome,
  planTransfer,
  resolveRoute,
  runAgentTransfer,
  type TransferRoute
} from '../lib/agentTransfer'
import {
  type AgentMode,
  type Disposition,
  type TransferKind,
  disposition,
  transferDisposition,
  isRiskyCommand,
  isRiskyLocalCommand
} from '../lib/agentPermissions'
import { clampCommandOutput, saveCommandOutput, readSavedOutput } from '../lib/commandOutput'
import { readSavedAttachment } from '../lib/attachments'
import { useSessionStore } from './useSessionStore'
import { useCommandHistoryStore } from './useCommandHistoryStore'

export type AgentStatus = 'idle' | 'streaming' | 'awaiting' | 'running'

/**
 * Per-tool-call state for a `transfer_file` call, keyed by tool_call_id.
 * `runningIds` alone can't carry this — the card needs both endpoints, the
 * dry-run totals, and live progress.
 */
export interface TransferMeta {
  srcName: string
  srcPath: string
  dstName: string
  dstPath: string
  route?: TransferRoute
  kind?: TransferKind
  /** Dry run: undefined = not scanned yet, null = unknowable (container source). */
  plan?: TransferPlan | null
  planning: boolean
  progress?: TransferProgress
}

export interface AgentSession {
  messages: ChatMessage[]
  status: AgentStatus
  streamingText: string
  runningIds: string[]
  transferMeta: Record<string, TransferMeta>
  error: string
}

// Stable empty reference so the selector doesn't loop when a session doesn't exist yet.
export const EMPTY_AGENT_SESSION: AgentSession = {
  messages: [],
  status: 'idle',
  streamingText: '',
  runningIds: [],
  transferMeta: {},
  error: ''
}

const EMPTY_TARGETS: AgentTarget[] = []

interface AgentStore {
  sessions: Record<string, AgentSession>
  mode: AgentMode
  setMode: (mode: AgentMode) => void
  /** Active provider id + model name used for chat requests. */
  activeProviderId?: string
  activeModel?: string
  setActiveModel: (providerId: string, model: string) => void
  /** Host bound to each terminal session — conversations persist under this host. */
  hostBySession: Record<string, string>
  /** Persistent conversation id per terminal session. */
  convBySession: Record<string, string>
  /** Terminal sessionIds the agent may run commands on (attached targets). */
  attachedBySession: Record<string, string[]>
  /** Resolved target descriptors (name/host) — kept in sync by the panel. */
  targetsBySession: Record<string, AgentTarget[]>
  ensureSelf: (agentSessionId: string) => void
  attach: (agentSessionId: string, termSessionId: string) => void
  detach: (agentSessionId: string, termSessionId: string) => void
  setTargets: (agentSessionId: string, targets: AgentTarget[]) => void
  bindHost: (sessionId: string, hostId: string) => void
  newConversation: (sessionId: string) => void
  openConversation: (sessionId: string, convId: string) => Promise<void>
  /**
   * `images` are data URLs attached to the user message (vision models only);
   * `attachments` are documents already extracted to text.
   */
  send: (sessionId: string, text: string, images?: string[], attachments?: Attachment[]) => void
  resolveCall: (sessionId: string, call: ToolCall, approve: boolean) => void
  /** Answer an ask_user question tool call, then continue the conversation. */
  answerQuestion: (sessionId: string, call: ToolCall, answer: string) => void
  /** Approve a presented plan: switch to a run mode and let the model execute it. */
  approvePlan: (sessionId: string, call: ToolCall, runMode: AgentMode) => void
  /** Interrupt the running turn: abort the LLM request and stop the agent loop. */
  stop: (sessionId: string) => void
  reset: (sessionId: string) => void
}

// Per-session runtime flags (not React state — read synchronously by the loop).
const activeRunId: Record<string, string> = {}
const stopped: Record<string, boolean> = {}

function parseArgs(call: ToolCall): { command: string; target?: string } {
  try {
    const args = JSON.parse(call.function.arguments || '{}')
    return { command: args.command ?? '', target: args.target }
  } catch {
    return { command: call.function.arguments }
  }
}

interface TransferArgs {
  sourceTarget?: string
  sourcePath: string
  destTarget?: string
  destPath: string
}

function parseTransferArgs(call: ToolCall): TransferArgs {
  try {
    const a = JSON.parse(call.function.arguments || '{}')
    return {
      sourceTarget: a.source_target,
      sourcePath: String(a.source_path ?? ''),
      destTarget: a.dest_target,
      destPath: String(a.dest_path ?? '')
    }
  } catch {
    return { sourcePath: '', destPath: '' }
  }
}

export const useAgentStore = create<AgentStore>((set, get) => {
  const cur = (id: string): AgentSession => get().sessions[id] ?? EMPTY_AGENT_SESSION

  const patch = (id: string, p: Partial<AgentSession>): void =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [id]: { ...(state.sessions[id] ?? EMPTY_AGENT_SESSION), ...p }
      }
    }))

  const persist = (id: string): void => {
    const { hostBySession, convBySession } = get()
    const hostId = hostBySession[id]
    const convId = convBySession[id]
    const msgs = cur(id).messages
    if (!hostId || !convId || msgs.length === 0) return
    const firstUser = msgs.find((m) => m.role === 'user')
    const titleSource =
      firstUser?.content?.trim() ||
      firstUser?.attachments?.[0]?.name ||
      (firstUser?.images?.length ? '[图片]' : '新会话')
    const title = titleSource.split('\n')[0].slice(0, 30)
    void window.api.agentChat.save(hostId, convId, title, msgs)
  }

  const pushMsgs = (id: string, msgs: ChatMessage[]): void => {
    set((state) => {
      const s = state.sessions[id] ?? EMPTY_AGENT_SESSION
      return { sessions: { ...state.sessions, [id]: { ...s, messages: [...s.messages, ...msgs] } } }
    })
    persist(id)
  }

  // Resolve which terminal a tool call targets, falling back to the first (self).
  const resolveTarget = (agentId: string, targetName?: string): AgentTarget | undefined => {
    const targets = get().targetsBySession[agentId] ?? EMPTY_TARGETS
    if (targetName) {
      const found = targets.find((t) => t.name === targetName)
      if (found) return found
    }
    return targets[0]
  }

  /**
   * Strict resolution for transfers: a name that doesn't match is an error, never a
   * fallback to targets[0]. run_command can fall back (its `target` is optional and
   * a wrong guess just runs a command); a transfer endpoint cannot — falling back
   * would silently write the files to the wrong machine.
   */
  const resolveTargetStrict = (agentId: string, targetName?: string): AgentTarget | undefined => {
    const targets = get().targetsBySession[agentId] ?? EMPTY_TARGETS
    if (!targetName) return targets.length === 1 ? targets[0] : undefined
    return targets.find((t) => t.name === targetName)
  }

  const executeCall = async (id: string, call: ToolCall): Promise<void> => {
    patch(id, { status: 'running', runningIds: [...cur(id).runningIds, call.id] })
    const { command, target } = parseArgs(call)
    const resolved = resolveTarget(id, target)
    let content = ''
    if (!resolved) {
      content = '执行出错: 没有可用的目标终端。请先在「目标终端」里附加一个已连接的终端。'
    } else {
      // Record the agent command against the *target* terminal's host (the agent may
      // target a terminal on a different host than its own panel). Record on attempt so
      // failed/timed-out commands still leave a trace.
      const targetHostId = useSessionStore
        .getState()
        .tabs.find((t) => t.id === resolved.sessionId)?.hostId
      if (targetHostId) useCommandHistoryStore.getState().add(targetHostId, command, 'agent')
      try {
        // 本机目标走 local:exec(宿主机 shell),其余走 SSH PTY。
        const res = isLocalTarget(resolved)
          ? await window.api.local.exec(command)
          : await window.api.ssh.runInShell(resolved.sessionId, command)
        // 完整输出留在本地(供 read_command_output 分页检索),喂给模型的是策略裁剪版。
        const ref = saveCommandOutput({
          output: res.output,
          exitCode: res.exitCode,
          timedOut: res.timedOut,
          state: res.state,
          note: res.note,
          name: resolved.name
        })
        content = clampCommandOutput({
          output: res.output,
          exitCode: res.exitCode,
          timedOut: res.timedOut,
          state: res.state,
          note: res.note,
          name: resolved.name,
          ref
        })
      } catch (e) {
        content = `[终端: ${resolved.name}] 执行出错: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    patch(id, { runningIds: cur(id).runningIds.filter((i) => i !== call.id) })
    pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content }])
  }

  const patchMeta = (id: string, callId: string, p: Partial<TransferMeta>): void => {
    const s = cur(id)
    const prev = s.transferMeta[callId]
    if (!prev) return
    patch(id, { transferMeta: { ...s.transferMeta, [callId]: { ...prev, ...p } } })
  }

  /**
   * Resolve a transfer_file call into endpoints + route, stashing the meta the card
   * renders from. Returns the disposition, or null if the call is already answered
   * (bad target / unsupported route both push their own tool message).
   */
  const prepareTransfer = (
    id: string,
    call: ToolCall
  ): { disp: Disposition; kind: TransferKind } | null => {
    const { sourceTarget, sourcePath, destTarget, destPath } = parseTransferArgs(call)
    const src = resolveTargetStrict(id, sourceTarget)
    const dst = resolveTargetStrict(id, destTarget)

    if (!src || !dst) {
      const available = (get().targetsBySession[id] ?? EMPTY_TARGETS).map((t) => t.name)
      const bad = [!src ? `source_target=${sourceTarget ?? '(空)'}` : '', !dst ? `dest_target=${destTarget ?? '(空)'}` : '']
        .filter(Boolean)
        .join('、')
      pushMsgs(id, [
        {
          role: 'tool',
          tool_call_id: call.id,
          content: `传输未执行: 找不到目标(${bad})。可用目标:${available.join('、') || '(无)'}。请用其中之一重试。`
        }
      ])
      return null
    }
    if (!sourcePath || !destPath) {
      pushMsgs(id, [
        {
          role: 'tool',
          tool_call_id: call.id,
          content: '传输未执行: source_path 与 dest_path 都必须是绝对路径,且不能为空。'
        }
      ])
      return null
    }

    const routed = resolveRoute(src, dst)
    if (!routed.ok) {
      pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content: `传输未执行: ${routed.reason}` }])
      return null
    }

    patch(id, {
      transferMeta: {
        ...cur(id).transferMeta,
        [call.id]: {
          srcName: src.name,
          srcPath: sourcePath,
          dstName: dst.name,
          dstPath: destPath,
          route: routed.route,
          kind: routed.kind,
          planning: false
        }
      }
    })
    return { disp: transferDisposition(get().mode, routed.kind), kind: routed.kind }
  }

  /** Dry run for the confirmation card. Runs detached — the card shows a spinner meanwhile. */
  const startPlanScan = (id: string, call: ToolCall): void => {
    const meta = cur(id).transferMeta[call.id]
    const src = resolveTargetStrict(id, parseTransferArgs(call).sourceTarget)
    if (!meta || !src) return
    patchMeta(id, call.id, { planning: true })
    void planTransfer(src, meta.srcPath)
      .then((plan) => patchMeta(id, call.id, { plan, planning: false }))
      // A failed scan is not fatal — the user can still approve; the real transfer
      // will surface the same error with better context.
      .catch(() => patchMeta(id, call.id, { plan: null, planning: false }))
  }

  const executeTransfer = async (id: string, call: ToolCall): Promise<void> => {
    const meta = cur(id).transferMeta[call.id]
    const { sourceTarget, destTarget } = parseTransferArgs(call)
    const src = resolveTargetStrict(id, sourceTarget)
    const dst = resolveTargetStrict(id, destTarget)
    if (!meta?.route || !src || !dst) {
      pushMsgs(id, [
        { role: 'tool', tool_call_id: call.id, content: '传输未执行: 目标信息已失效,请重试。' }
      ])
      return
    }

    patch(id, { status: 'running', runningIds: [...cur(id).runningIds, call.id] })
    const outcome = await runAgentTransfer({
      src,
      srcPath: meta.srcPath,
      dst,
      dstPath: meta.dstPath,
      route: meta.route,
      ownerId: id,
      onProgress: (p) => patchMeta(id, call.id, { progress: p })
    })
    patch(id, { runningIds: cur(id).runningIds.filter((i) => i !== call.id) })
    pushMsgs(id, [
      {
        role: 'tool',
        tool_call_id: call.id,
        content: describeOutcome(outcome, src, meta.srcPath, dst, meta.dstPath)
      }
    ])
  }

  // read_command_output / read_attachment:纯本地检索已保存的完整文本,
  // 只读、无副作用,任何模式下都直接执行(不走审批)。
  const executeLookup = (id: string, call: ToolCall): void => {
    const lookup = call.function.name === 'read_attachment' ? readSavedAttachment : readSavedOutput
    let content: string
    try {
      const args = JSON.parse(call.function.arguments || '{}')
      const range =
        Array.isArray(args.range) && args.range.length === 2
          ? ([Number(args.range[0]), Number(args.range[1])] as [number, number])
          : undefined
      content = lookup(String(args.ref ?? ''), {
        grep: args.grep,
        head: typeof args.head === 'number' ? args.head : undefined,
        tail: typeof args.tail === 'number' ? args.tail : undefined,
        range
      })
    } catch (e) {
      content = `检索出错: ${e instanceof Error ? e.message : String(e)}`
    }
    pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content }])
  }

  const processToolCalls = async (id: string, calls: ToolCall[]): Promise<void> => {
    const mode = get().mode
    let anyAsk = false
    for (const call of calls) {
      if (stopped[id]) {
        patch(id, { status: 'idle' })
        return
      }
      // ask_user / present_plan are always interactive (question / plan-approval cards).
      if (call.function.name === 'ask_user' || call.function.name === 'present_plan') {
        anyAsk = true
        continue
      }
      // Read-only local lookups (saved command output / attachment full text) — always
      // safe to run inline, no approval.
      if (
        call.function.name === 'read_command_output' ||
        call.function.name === 'read_attachment'
      ) {
        executeLookup(id, call)
        continue
      }
      // 文件传输:结构化调用,不走 shell,也不能用 isRiskyCommand 判定。
      if (call.function.name === 'transfer_file') {
        const prepared = prepareTransfer(id, call)
        if (!prepared) continue // 已经推了说明性的 tool 消息
        if (prepared.disp === 'auto') {
          await executeTransfer(id, call)
        } else if (prepared.disp === 'block') {
          pushMsgs(id, [
            {
              role: 'tool',
              tool_call_id: call.id,
              content:
                '【计划模式】未执行该文件传输。请把它写进方案(说明源、目标与用途),用户切换到执行模式后再传。'
            }
          ])
        } else {
          startPlanScan(id, call) // 后台预扫描,卡片先显示「正在统计…」
          anyAsk = true
        }
        continue
      }
      // 兜底:未知工具名。没有这一条会掉进下面的 run_command 分支,
      // 被解析成空命令后真的送到终端去执行。
      if (call.function.name !== 'run_command') {
        pushMsgs(id, [
          {
            role: 'tool',
            tool_call_id: call.id,
            content: `不支持的工具「${call.function.name}」,未执行。请只使用已提供的工具。`
          }
        ])
        continue
      }
      // 风险判定按目标平台分派:本机(win32 → PowerShell 规则)vs SSH 远程(Unix 规则)。
      const { command, target } = parseArgs(call)
      const resolved = resolveTarget(id, target)
      const risky = isLocalTarget(resolved) ? isRiskyLocalCommand(command) : isRiskyCommand(command)
      const disp = disposition(mode, risky)
      if (disp === 'auto') {
        await executeCall(id, call)
      } else if (disp === 'block') {
        pushMsgs(id, [
          {
            role: 'tool',
            tool_call_id: call.id,
            content:
              '【计划模式】未执行该写操作。请先给出完整的操作方案(步骤 + 命令),用户会在切换到执行模式或逐条确认后再运行。'
          }
        ])
      } else {
        anyAsk = true
      }
    }
    if (anyAsk) {
      patch(id, { status: 'awaiting' })
    } else {
      maybeContinue(id)
    }
  }

  const runTurn = async (id: string): Promise<void> => {
    if (stopped[id]) return
    patch(id, { status: 'streaming', streamingText: '', error: '' })
    const runId = crypto.randomUUID()
    activeRunId[id] = runId
    let acc = ''
    const offDelta = window.api.llm.onDelta(runId, (t) => {
      acc += t
      patch(id, { streamingText: acc })
    })
    const targets = get().targetsBySession[id] ?? EMPTY_TARGETS
    const finalMsg = await new Promise<ChatMessage>((resolve) => {
      const offDone = window.api.llm.onDone(runId, (m) => {
        offDone()
        offErr()
        resolve(m)
      })
      const offErr = window.api.llm.onError(runId, (msg) => {
        offDone()
        offErr()
        patch(id, { error: msg })
        resolve({ role: 'assistant', content: '' })
      })
      const mode = get().mode
      const sys: ChatMessage = { role: 'system', content: buildSystemPrompt(targets, mode) }
      window.api.llm.chat(runId, {
        messages: [sys, ...cur(id).messages],
        tools: buildAgentTools(targets, mode),
        providerId: get().activeProviderId,
        model: get().activeModel
      })
    })
    offDelta()
    patch(id, { streamingText: '' })
    if (finalMsg.content || finalMsg.tool_calls?.length) pushMsgs(id, [finalMsg])
    // If the user hit stop during streaming, keep the partial answer but don't continue.
    if (stopped[id]) {
      patch(id, { status: 'idle' })
      return
    }
    if (finalMsg.tool_calls?.length) {
      await processToolCalls(id, finalMsg.tool_calls)
    } else {
      patch(id, { status: 'idle' })
    }
  }

  const maybeContinue = (id: string): void => {
    if (stopped[id]) return
    const msgs = cur(id).messages
    let lastAsst: ChatMessage | undefined
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && msgs[i].tool_calls?.length) {
        lastAsst = msgs[i]
        break
      }
    }
    if (!lastAsst?.tool_calls) return
    const allResolved = lastAsst.tool_calls.every((tc) =>
      msgs.some((m) => m.role === 'tool' && m.tool_call_id === tc.id)
    )
    if (allResolved) void runTurn(id)
  }

  return {
    sessions: {},
    mode: 'ask',
    setMode: (mode) => set({ mode }),
    activeProviderId: undefined,
    activeModel: undefined,
    setActiveModel: (providerId, model) =>
      set({ activeProviderId: providerId, activeModel: model }),

    hostBySession: {},
    convBySession: {},
    attachedBySession: {},
    targetsBySession: {},

    ensureSelf: (agentId) =>
      set((state) => {
        const list = state.attachedBySession[agentId]
        if (list && list.includes(agentId)) return state
        return {
          attachedBySession: {
            ...state.attachedBySession,
            [agentId]: [agentId, ...(list ?? []).filter((x) => x !== agentId)]
          }
        }
      }),

    attach: (agentId, termId) =>
      set((state) => {
        const list = state.attachedBySession[agentId] ?? [agentId]
        if (list.includes(termId)) return state
        return { attachedBySession: { ...state.attachedBySession, [agentId]: [...list, termId] } }
      }),

    detach: (agentId, termId) =>
      set((state) => {
        const list = state.attachedBySession[agentId] ?? [agentId]
        // never detach the panel's own terminal
        if (termId === agentId) return state
        return {
          attachedBySession: {
            ...state.attachedBySession,
            [agentId]: list.filter((x) => x !== termId)
          }
        }
      }),

    setTargets: (agentId, targets) =>
      set((state) => ({ targetsBySession: { ...state.targetsBySession, [agentId]: targets } })),

    bindHost: (id, hostId) =>
      set((state) => ({ hostBySession: { ...state.hostBySession, [id]: hostId } })),

    newConversation: (id) => {
      if (cur(id).status !== 'idle') return
      set((state) => ({
        convBySession: { ...state.convBySession, [id]: crypto.randomUUID() },
        sessions: { ...state.sessions, [id]: { ...EMPTY_AGENT_SESSION } }
      }))
    },

    openConversation: async (id, convId) => {
      if (cur(id).status !== 'idle') return
      const hostId = get().hostBySession[id]
      if (!hostId) return
      const messages = await window.api.agentChat.load(hostId, convId)
      set((state) => ({
        convBySession: { ...state.convBySession, [id]: convId },
        sessions: { ...state.sessions, [id]: { ...EMPTY_AGENT_SESSION, messages } }
      }))
    },

    send: (id, text, images, attachments) => {
      if (cur(id).status !== 'idle') return
      stopped[id] = false
      if (!get().convBySession[id]) {
        set((state) => ({
          convBySession: { ...state.convBySession, [id]: crypto.randomUUID() }
        }))
      }
      pushMsgs(id, [
        {
          role: 'user',
          content: text,
          ...(images?.length ? { images } : {}),
          ...(attachments?.length ? { attachments } : {})
        }
      ])
      void runTurn(id)
    },

    resolveCall: async (id, call, approve) => {
      stopped[id] = false
      const isTransfer = call.function.name === 'transfer_file'
      if (!approve) {
        // Keep the 「用户已拒绝」 prefix — the cards key their "note" styling off it.
        const content = isTransfer ? '用户已拒绝该文件传输。' : '用户已拒绝执行该命令。'
        pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content }])
        maybeContinue(id)
        return
      }
      await (isTransfer ? executeTransfer(id, call) : executeCall(id, call))
      maybeContinue(id)
    },

    answerQuestion: (id, call, answer) => {
      stopped[id] = false
      pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content: answer }])
      maybeContinue(id)
    },

    approvePlan: (id, call, runMode) => {
      stopped[id] = false
      set({ mode: runMode })
      pushMsgs(id, [
        {
          role: 'tool',
          tool_call_id: call.id,
          content: `用户已确认该方案,并将权限切换为「${runMode}」。请按方案逐条执行(用 run_command,注意 target),完成后简要汇报。`
        }
      ])
      maybeContinue(id)
    },

    stop: (id) => {
      stopped[id] = true
      if (activeRunId[id]) void window.api.llm.abort(activeRunId[id])
      patch(id, { status: 'idle', streamingText: '' })
    },

    reset: (id) => patch(id, { ...EMPTY_AGENT_SESSION })
  }
})
