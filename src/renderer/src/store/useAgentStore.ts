import { create } from 'zustand'
import type {
  Attachment,
  ChatMessage,
  LlmErrorInfo,
  ProxyEntry,
  ToolCall,
  TransferPlan,
  TransferProgress
} from '@shared/types'
import {
  judgeCheck,
  MAX_CHECK_ERRORS,
  parseWaitArgs,
  runCheck,
  waitResultText,
  type WaitArgs,
  type WaitOutcome,
  type WaitState
} from '../lib/agentWait'
import {
  computeAgentTargets,
  findTargetCandidates,
  type TargetCandidate
} from '../lib/targetRequest'
import { connectionStatus, waitForConnected } from '../lib/connectionRegistry'
import {
  buildAgentTools,
  buildSystemPrompt,
  isLocalTarget,
  PROXY_PLACEHOLDER,
  type AgentTarget,
  type ProxyContext
} from '../lib/agentTools'
import {
  describeProxyForModel,
  flagEmoji,
  maskSecret,
  normalizeSite,
  proxyUrl,
  rankProxiesFor,
  regionText,
  targetKeyOf,
  useProxyUiStore,
  type RankedProxy
} from '../lib/proxies'
import { useVaultStore } from './useVaultStore'
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
import { requestReconnect } from '../lib/reconnectRegistry'
import { useSessionStore } from './useSessionStore'
import { useCommandHistoryStore } from './useCommandHistoryStore'

/** waiting:wait_and_check 倒计时中 —— 模型不在跑,客户端按间隔做本地检查。 */
export type AgentStatus = 'idle' | 'streaming' | 'awaiting' | 'running' | 'waiting'

export type { WaitState } from '../lib/agentWait'

/** request_target 卡片的状态,keyed by tool_call_id。 */
export interface TargetRequestMeta {
  query: string
  reason: string
  candidates: TargetCandidate[]
  /** 正在附加 / 连接的候选(candidateKey),卡片显示进度。 */
  connecting?: string
}

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

/** use_proxy 卡片上可选的一个代理(不含凭据)。 */
export interface ProxyOption {
  id: string
  name: string
  /** 给人看的一行:地区 · 延迟 · 站点探测。 */
  summary: string
  flag: string
}

/** Per-tool-call state for a `use_proxy` call, keyed by tool_call_id. */
export interface ProxyMeta {
  targetName: string
  /** 检测位置:'local' 或宿主机 hostId。 */
  key: string
  /** 目标是容器(代理按宿主机检测)。 */
  container: boolean
  site?: string
  reason?: string
  /** null = 正在挑选/检测中。 */
  options: ProxyOption[] | null
  /** 询问模式下卡片当前选中的代理;自动模式下为最终选用的代理。 */
  selectedId?: string
}

export interface AgentSession {
  messages: ChatMessage[]
  status: AgentStatus
  streamingText: string
  runningIds: string[]
  transferMeta: Record<string, TransferMeta>
  proxyMeta: Record<string, ProxyMeta>
  targetRequestMeta: Record<string, TargetRequestMeta>
  /** 进行中的 wait_and_check;无等待时为 undefined。 */
  wait?: WaitState
  /** 最近一次 LLM 请求失败的信息;成功发起新一轮时清空。 */
  error: LlmErrorInfo | null
}

// Stable empty reference so the selector doesn't loop when a session doesn't exist yet.
export const EMPTY_AGENT_SESSION: AgentSession = {
  messages: [],
  status: 'idle',
  streamingText: '',
  runningIds: [],
  transferMeta: {},
  proxyMeta: {},
  targetRequestMeta: {},
  error: null
}

/** 当前智能体代理上下文(策略 + 代理数),组装工具与系统提示时用。 */
export function currentProxyContext(): ProxyContext {
  return {
    mode: useProxyUiStore.getState().agentMode,
    count: useVaultStore.getState().proxies.length
  }
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
  /** 询问模式下 use_proxy 卡片里切换代理。 */
  selectProxyOption: (sessionId: string, callId: string, proxyId: string) => void
  /** 回答 use_proxy:proxyId 为 null 表示用户不使用代理。 */
  resolveProxy: (sessionId: string, call: ToolCall, proxyId: string | null) => void
  /** Answer an ask_user question tool call, then continue the conversation. */
  answerQuestion: (sessionId: string, call: ToolCall, answer: string) => void
  /** Approve a presented plan: switch to a run mode and let the model execute it. */
  approvePlan: (sessionId: string, call: ToolCall, runMode: AgentMode) => void
  /** 回答 request_target:choice 为 null 表示用户拒绝补充该目标。 */
  resolveTargetRequest: (sessionId: string, call: ToolCall, choice: TargetCandidate | null) => void
  /** 重新发起上一轮(LLM 请求失败后的「重试」)。 */
  retry: (sessionId: string) => void
  /** 等待中:立即执行一次检查。 */
  checkNow: (sessionId: string) => void
  /** 等待中:提前结束等待,把当前进度交给模型继续。 */
  endWait: (sessionId: string) => void
  /** 等待中:取消等待并停止本轮任务。 */
  cancelWait: (sessionId: string) => void
  /** Interrupt the running turn: abort the LLM request and stop the agent loop. */
  stop: (sessionId: string) => void
  reset: (sessionId: string) => void
}

// Per-session runtime flags (not React state — read synchronously by the loop).
const activeRunId: Record<string, string> = {}
const stopped: Record<string, boolean> = {}
/** 每个会话里、每个目标(按名字)当前选用的代理 id —— {{proxy}} 据此替换。 */
const proxyChoice: Record<string, Record<string, string>> = {}
/** 每个会话里、每个目标已经用过的代理,再次 use_proxy 时换一个。 */
const proxyTried: Record<string, Record<string, string[]>> = {}
/** 每个会话的等待计时器。 */
const waitTimers: Record<string, ReturnType<typeof setTimeout>> = {}
/** 等待代数:每次开始 / 结束等待加一,用来丢弃已作废的检查结果(检查是异步的)。 */
const waitGen: Record<string, number> = {}

function parseProxyArgs(call: ToolCall): { target?: string; site?: string; reason?: string } {
  try {
    const a = JSON.parse(call.function.arguments || '{}')
    return {
      target: typeof a.target === 'string' ? a.target : undefined,
      site: typeof a.site === 'string' ? a.site : undefined,
      reason: typeof a.reason === 'string' ? a.reason : undefined
    }
  } catch {
    return {}
  }
}

function toOption(x: RankedProxy): ProxyOption {
  const r = x.result
  const parts = [regionText(r) || '未知地区']
  if (r.latencyMs !== undefined) parts.push(`${r.latencyMs}ms`)
  if (r.probe) parts.push(r.probe.ok ? '站点可达' : '站点不可达')
  return {
    id: x.proxy.id,
    name: x.proxy.name,
    summary: parts.join(' · '),
    flag: flagEmoji(r.countryCode) || (r.countryCode?.toUpperCase() ?? '')
  }
}

/** 选定代理后回给模型的说明:不含账号密码,只有占位符用法。 */
function proxyChosenMessage(x: RankedProxy, targetName: string, container: boolean): string {
  const socks = x.proxy.type === 'socks5'
  return [
    `已为「${targetName}」选用代理 ${describeProxyForModel(x)}。`,
    `在 run_command 的命令里用 ${PROXY_PLACEHOLDER} 代表该代理地址(执行前自动替换为真实地址),只对当次命令生效,例如:`,
    `- curl -x ${PROXY_PLACEHOLDER} -fL <url> -o <file>`,
    `- https_proxy=${PROXY_PLACEHOLDER} http_proxy=${PROXY_PLACEHOLDER} all_proxy=${PROXY_PLACEHOLDER} <命令>`,
    `- git -c http.proxy=${PROXY_PLACEHOLDER} clone <repo>`,
    socks
      ? '这是 SOCKS5 代理(替换为 socks5h://,DNS 也走代理):curl、git 可直接用;pip 需要 PySocks,apt/yum 不支持 SOCKS,必要时告知用户。'
      : `- pip install --proxy ${PROXY_PLACEHOLDER} <包>`,
    ...(container ? ['注意:该目标是容器,代理是在其宿主机上检测的,容器网络可能与宿主机不同。'] : [])
  ].join('\n')
}

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

  /**
   * 解析工具调用的 target。省略时回退到第一个目标(面板自己的终端);
   * **指名了却对不上时返回 undefined** —— 以前这里也回退到 targets[0],
   * 模型想在另一台机器上跑的命令会被悄悄下发到当前机器上。
   * 宽容两种常见写法:带 @ 前缀、写的是主机标签而非目标名(唯一匹配时)。
   */
  const resolveTarget = (agentId: string, targetName?: string): AgentTarget | undefined => {
    const targets = get().targetsBySession[agentId] ?? EMPTY_TARGETS
    const name = targetName?.trim().replace(/^@/, '')
    if (!name) return targets[0]
    const exact = targets.find((t) => t.name === name)
    if (exact) return exact
    const byHost = targets.filter((t) => t.host === name)
    return byHost.length === 1 ? byHost[0] : undefined
  }

  /** 指名的目标不在列表里时回给模型的说明。 */
  const unknownTargetMessage = (agentId: string, targetName: string): string => {
    const names = (get().targetsBySession[agentId] ?? EMPTY_TARGETS).map((t) => t.name)
    return (
      `未执行: 目标「${targetName}」不在当前目标列表中(可用: ${names.join('、') || '无'})。` +
      '如需在该服务器上操作,请调用 request_target 请用户补充该目标;不要改在其他目标上执行。'
    )
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
    // {{proxy}} → 该目标已选代理的真实地址。密码只在这里代入,回给模型的输出再把它遮掉。
    let realCommand = command
    let proxy: ProxyEntry | undefined
    let proxyError = ''
    if (resolved && command.includes(PROXY_PLACEHOLDER)) {
      const pid = proxyChoice[id]?.[resolved.name]
      proxy = pid ? useVaultStore.getState().proxies.find((p) => p.id === pid) : undefined
      if (!proxy) {
        proxyError = `执行出错: 命令中使用了 ${PROXY_PLACEHOLDER},但还没有为「${resolved.name}」选定代理(或该代理已被删除)。请先调用 use_proxy(target=${resolved.name})。`
      } else {
        realCommand = command.split(PROXY_PLACEHOLDER).join(proxyUrl(proxy, { remoteDns: true }))
      }
    }
    let content = ''
    if (!resolved && target?.trim()) {
      content = unknownTargetMessage(id, target)
    } else if (!resolved) {
      content = '执行出错: 没有可用的目标终端。请先在「目标终端」里附加一个已连接的终端。'
    } else if (proxyError) {
      content = proxyError
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
        const raw = isLocalTarget(resolved)
          ? await window.api.local.exec(realCommand)
          : await window.api.ssh.runInShell(resolved.sessionId, realCommand)
        const res = proxy
          ? { ...raw, output: maskSecret(raw.output, proxy), note: raw.note && maskSecret(raw.note, proxy) }
          : raw
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
        const msg = e instanceof Error ? e.message : String(e)
        content = `[终端: ${resolved.name}] 执行出错: ${maskSecret(msg, proxy)}`
      }
    }
    patch(id, { runningIds: cur(id).runningIds.filter((i) => i !== call.id) })
    pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content }])
  }

  // reconnect_terminal:重连某个断开的 SSH 终端。走渲染层的 reconnect 注册表,
  // 由对应的 TerminalTab 执行真正的重连并把成功/失败回给模型。
  const executeReconnect = async (id: string, call: ToolCall): Promise<void> => {
    patch(id, { status: 'running', runningIds: [...cur(id).runningIds, call.id] })
    const { target } = parseArgs(call)
    // 显式 target 按名字匹配;省略时回退到第一个 SSH 目标(而非 targets[0],那可能是本机)。
    const targets = get().targetsBySession[id] ?? EMPTY_TARGETS
    const resolved = target
      ? targets.find((t) => t.name === target)
      : targets.find((t) => !isLocalTarget(t))
    let content = ''
    if (!resolved) {
      content = '重连失败: 没有匹配的目标终端。'
    } else if (isLocalTarget(resolved)) {
      content = `「${resolved.name}」是用户本机,不是 SSH 连接,无需也无法重连。`
    } else {
      const pending = requestReconnect(resolved.sessionId)
      if (!pending) {
        content = `重连失败: 终端「${resolved.name}」的标签页未打开(可能已被关闭),无法为其重连。请提示用户重新打开该终端。`
      } else {
        try {
          await pending
          content = `已重新连接终端「${resolved.name}」,可以继续下发命令。`
        } catch (e) {
          content = `重连「${resolved.name}」失败: ${e instanceof Error ? e.message : String(e)}。可提示用户检查网络或凭据。`
        }
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

  // ---- use_proxy ----

  const patchProxyMeta = (id: string, callId: string, p: Partial<ProxyMeta>): void => {
    const s = cur(id)
    const prev = s.proxyMeta[callId]
    if (!prev) return
    patch(id, { proxyMeta: { ...s.proxyMeta, [callId]: { ...prev, ...p } } })
  }

  /** 校验 use_proxy 并登记卡片状态;不能继续时直接推说明性的 tool 消息并返回 null。 */
  const prepareProxy = (id: string, call: ToolCall): ProxyMeta | null => {
    const reply = (content: string): null => {
      pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content }])
      return null
    }
    const ctx = currentProxyContext()
    if (ctx.mode === 'off') {
      return reply('用户已关闭智能体使用代理,不能使用代理。请改用其他方案(如镜像源)或向用户说明。')
    }
    if (ctx.count === 0) {
      return reply('用户还没有配置任何代理。请告知用户可在左侧「代理」页添加,或改用镜像源等方案。')
    }
    const args = parseProxyArgs(call)
    const target = resolveTarget(id, args.target)
    if (!target && args.target?.trim()) return reply(unknownTargetMessage(id, args.target))
    if (!target) return reply('没有可用的目标,无法挑选代理。')
    const key = targetKeyOf(target)
    if (!key) return reply(`无法确定「${target.name}」对应的主机,不能为它检测代理。`)
    const meta: ProxyMeta = {
      targetName: target.name,
      key,
      container: Boolean(target.containerId),
      site: normalizeSite(args.site),
      reason: args.reason,
      options: null
    }
    patch(id, { proxyMeta: { ...cur(id).proxyMeta, [call.id]: meta } })
    return meta
  }

  /** 在目标所在机器上挑可用代理(必要时现测),排除本会话里该目标已经用过的。 */
  const rankForCall = async (id: string, call: ToolCall, meta: ProxyMeta): Promise<RankedProxy[]> => {
    patch(id, { status: 'running', runningIds: [...cur(id).runningIds, call.id] })
    try {
      const tried = proxyTried[id]?.[meta.targetName] ?? []
      const ranked = (await rankProxiesFor(meta.key, meta.site)).filter(
        (x) => !tried.includes(x.proxy.id)
      )
      patchProxyMeta(id, call.id, {
        options: ranked.map(toOption),
        selectedId: ranked[0]?.proxy.id
      })
      return ranked
    } finally {
      patch(id, { runningIds: cur(id).runningIds.filter((i) => i !== call.id) })
    }
  }

  const applyProxyChoice = (id: string, call: ToolCall, meta: ProxyMeta, x: RankedProxy): void => {
    proxyChoice[id] = { ...proxyChoice[id], [meta.targetName]: x.proxy.id }
    const tried = proxyTried[id]?.[meta.targetName] ?? []
    proxyTried[id] = { ...proxyTried[id], [meta.targetName]: [...tried, x.proxy.id] }
    patchProxyMeta(id, call.id, { selectedId: x.proxy.id })
    pushMsgs(id, [
      {
        role: 'tool',
        tool_call_id: call.id,
        content: proxyChosenMessage(x, meta.targetName, meta.container)
      }
    ])
  }

  const noProxyMessage = (id: string, meta: ProxyMeta): string => {
    const tried = proxyTried[id]?.[meta.targetName]?.length ?? 0
    return (
      `没有找到可用代理:在「${meta.targetName}」上检测的代理均不可用` +
      (meta.site ? `或无法访问 ${meta.site}` : '') +
      (tried ? `(已排除本次会话里用过的 ${tried} 个)` : '') +
      '。请向用户说明,建议到「代理」页添加或检测代理,或改用镜像源等替代方案。'
    )
  }

  // ---- wait_and_check ----

  const patchWait = (id: string, p: Partial<WaitState>): void => {
    const w = cur(id).wait
    if (w) patch(id, { wait: { ...w, ...p } })
  }

  const clearWaitTimer = (id: string): void => {
    if (waitTimers[id] !== undefined) {
      clearTimeout(waitTimers[id])
      delete waitTimers[id]
    }
  }

  const scheduleTick = (id: string, delayMs: number): void => {
    clearWaitTimer(id)
    patchWait(id, { phase: 'counting', nextAt: Date.now() + delayMs })
    waitTimers[id] = setTimeout(() => void runWaitTick(id), delayMs)
  }

  /**
   * 结束等待并把结果作为 wait_and_check 的 tool 消息推回。
   * `resume`:是否接着唤醒模型(用户取消 / 发新消息时不在这里续跑)。
   */
  const finishWait = (id: string, outcome: WaitOutcome, resume: boolean): void => {
    const w = cur(id).wait
    clearWaitTimer(id)
    waitGen[id] = (waitGen[id] ?? 0) + 1
    if (!w) return
    patch(id, { wait: undefined, status: resume ? 'running' : 'idle' })
    pushMsgs(id, [{ role: 'tool', tool_call_id: w.callId, content: waitResultText(w, outcome) }])
    if (!resume) return
    maybeContinue(id)
    // runTurn 会同步切到 streaming;没续上(例如刚被停止)就回到空闲,别卡在 running。
    if (cur(id).status === 'running' && cur(id).runningIds.length === 0) patch(id, { status: 'idle' })
  }

  const runWaitTick = async (id: string): Promise<void> => {
    const w = cur(id).wait
    if (!w || w.phase === 'checking') return
    clearWaitTimer(id)
    // 没有检查命令:单纯等待,时间到就唤醒模型。
    if (!w.command) {
      finishWait(id, 'slept', true)
      return
    }
    const gen = waitGen[id]
    patchWait(id, { phase: 'checking' })
    const target = (get().targetsBySession[id] ?? EMPTY_TARGETS).find((t) => t.name === w.targetName)
    let result: { output: string; exitCode: number | null } | null = null
    let errMsg = ''
    if (!target) {
      errMsg = `目标「${w.targetName}」已不在目标列表中(终端可能已关闭)`
    } else {
      try {
        result = await runCheck(target, w.command)
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e)
      }
    }
    // 检查期间等待被取消 / 结束 / 重新开始了:丢弃这次结果。
    if (waitGen[id] !== gen || !cur(id).wait) return
    const now = Date.now()
    const cw = cur(id).wait!
    if (!result) {
      const errors = cw.errors + 1
      patchWait(id, { errors, lastOutput: `检查失败: ${errMsg}`, lastExitCode: null, lastCheckedAt: now })
      if (errors >= MAX_CHECK_ERRORS) return finishWait(id, 'error', true)
    } else {
      patchWait(id, {
        ticks: cw.ticks + 1,
        errors: 0,
        lastOutput: result.output,
        lastExitCode: result.exitCode,
        lastCheckedAt: now
      })
      const verdict = judgeCheck(cw, result)
      if (verdict === 'done') return finishWait(id, 'done', true)
      if (verdict === 'failed') return finishWait(id, 'failed', true)
    }
    if (now >= cw.deadline) return finishWait(id, 'timeout', true)
    scheduleTick(id, Math.min(cw.intervalSec * 1000, Math.max(1000, cw.deadline - now)))
  }

  const startWait = (id: string, call: ToolCall, args: WaitArgs, target: AgentTarget): void => {
    clearWaitTimer(id)
    waitGen[id] = (waitGen[id] ?? 0) + 1
    const now = Date.now()
    const wait: WaitState = {
      callId: call.id,
      reason: args.reason,
      targetName: target.name,
      command: args.command,
      intervalSec: args.intervalSec,
      startedAt: now,
      deadline: now + args.maxWaitSec * 1000,
      nextAt: now + args.intervalSec * 1000,
      ticks: 0,
      phase: 'counting',
      lastOutput: '',
      lastExitCode: null,
      errors: 0,
      doneExit: args.doneExit,
      donePattern: args.donePattern,
      failPattern: args.failPattern
    }
    if (args.command) {
      const hostId = useSessionStore.getState().tabs.find((t) => t.id === target.sessionId)?.hostId
      if (hostId) useCommandHistoryStore.getState().add(hostId, args.command, 'agent')
    }
    patch(id, { status: 'waiting', wait })
    scheduleTick(id, args.intervalSec * 1000)
  }

  /** 校验 wait_and_check;不能开始时推说明性的 tool 消息并返回 null。 */
  const prepareWait = (id: string, call: ToolCall): { args: WaitArgs; target: AgentTarget } | null => {
    const reply = (content: string): null => {
      pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content: `未开始等待: ${content}` }])
      return null
    }
    const parsed = parseWaitArgs(call)
    if (!parsed.ok) return reply(parsed.error)
    const { args } = parsed
    const target = resolveTarget(id, args.target)
    if (!target) {
      return reply(args.target ? unknownTargetMessage(id, args.target) : '没有可用的目标。')
    }
    if (args.command) {
      const risky = isLocalTarget(target) ? isRiskyLocalCommand(args.command) : isRiskyCommand(args.command)
      if (risky) {
        return reply(
          '检查命令必须是只读命令(查看日志、进程、文件是否存在等),不能包含写操作。请改成只读形式后重试。'
        )
      }
    }
    return { args, target }
  }

  // ---- request_target ----

  const patchTargetMeta = (id: string, callId: string, p: Partial<TargetRequestMeta>): void => {
    const s = cur(id)
    const prev = s.targetRequestMeta[callId]
    if (!prev) return
    patch(id, { targetRequestMeta: { ...s.targetRequestMeta, [callId]: { ...prev, ...p } } })
  }

  /** 勾选后立刻重算目标(不等面板的 effect —— 面板可能没挂载),返回新目标。 */
  const attachAndResolve = (id: string, termId: string): AgentTarget | undefined => {
    get().attach(id, termId)
    const { tabs } = useSessionStore.getState()
    const targets = computeAgentTargets(
      id,
      get().attachedBySession[id] ?? [id],
      tabs,
      useVaultStore.getState().hosts
    )
    get().setTargets(id, targets)
    return targets.find((t) => t.sessionId === termId)
  }

  const executeTargetRequest = async (
    id: string,
    call: ToolCall,
    choice: TargetCandidate
  ): Promise<void> => {
    patch(id, { status: 'running', runningIds: [...cur(id).runningIds, call.id] })
    patchTargetMeta(id, call.id, {
      connecting: choice.kind === 'tab' ? `tab:${choice.tabId}` : `host:${choice.hostId}`
    })
    let content: string
    if (choice.kind === 'tab') {
      const t = attachAndResolve(id, choice.tabId)
      const st = connectionStatus(choice.tabId)
      content = t
        ? `已将终端「${t.name}」(${t.host})加入目标。之后 run_command 请用 target="${t.name}"。` +
          (st && st !== 'connected' && st !== 'connecting'
            ? '注意:该终端当前未连接,先调用 reconnect_terminal 重连。'
            : '')
        : `加入目标失败: 终端「${choice.title}」已不存在(可能已被关闭)。`
    } else {
      const host = useVaultStore.getState().hosts.find((h) => h.id === choice.hostId)
      if (!host) {
        content = `加入目标失败: 主机库里已找不到「${choice.label}」。`
      } else {
        const tabId = `terminal-${host.id}-${Date.now()}`
        // 后台打开,不抢用户当前的 tab;所有 tab 都常驻挂载,所以会在后台照常连接。
        useSessionStore
          .getState()
          .openTab({ id: tabId, kind: 'terminal', title: host.label, hostId: host.id }, { activate: false })
        const t = attachAndResolve(id, tabId)
        const name = t?.name ?? host.label
        try {
          await waitForConnected(tabId, 45_000)
          content = `已连接主机「${host.label}」(${host.username}@${host.address})并加入目标。之后 run_command 请用 target="${name}"。`
        } catch (e) {
          content =
            `已为「${host.label}」新开终端并加入目标(target="${name}"),但连接失败: ` +
            `${e instanceof Error ? e.message : String(e)}。请提示用户在该终端标签页处理后,再调用 reconnect_terminal 重试。`
        }
      }
    }
    patchTargetMeta(id, call.id, { connecting: undefined })
    patch(id, { runningIds: cur(id).runningIds.filter((i) => i !== call.id) })
    pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content }])
  }

  /**
   * 登记 request_target:已在目标里 → 直接回答;完全访问 + 唯一候选 → 返回该候选自动执行;
   * 其余情况登记卡片状态并返回 'ask'。
   */
  const prepareTargetRequest = (id: string, call: ToolCall): TargetCandidate | 'ask' | null => {
    let a: { query?: unknown; reason?: unknown } = {}
    try {
      a = JSON.parse(call.function.arguments || '{}')
    } catch {
      // 当空参数处理
    }
    const query = typeof a.query === 'string' ? a.query.trim() : ''
    const reason = typeof a.reason === 'string' ? a.reason.trim() : ''
    if (!query) {
      pushMsgs(id, [
        { role: 'tool', tool_call_id: call.id, content: 'request_target 需要 query(主机标签 / IP / 域名)。' }
      ])
      return null
    }
    const search = findTargetCandidates(query, {
      tabs: useSessionStore.getState().tabs,
      hosts: useVaultStore.getState().hosts,
      targets: get().targetsBySession[id] ?? EMPTY_TARGETS
    })
    if (search.already) {
      pushMsgs(id, [
        {
          role: 'tool',
          tool_call_id: call.id,
          content: `「${search.already.name}」(${search.already.host})已经在目标中,run_command 时用 target="${search.already.name}" 即可。`
        }
      ])
      return null
    }
    patch(id, {
      targetRequestMeta: {
        ...cur(id).targetRequestMeta,
        [call.id]: { query, reason, candidates: search.candidates }
      }
    })
    if (get().mode === 'full' && search.candidates.length === 1) return search.candidates[0]
    return 'ask'
  }

  const processToolCalls = async (id: string, calls: ToolCall[]): Promise<void> => {
    const mode = get().mode
    let anyAsk = false
    let pendingWait: { call: ToolCall; args: WaitArgs; target: AgentTarget } | null = null
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
      // 重连终端:恢复用户已配置好的连接、不执行任何 shell 命令,任何模式下都直接执行
      // (包括计划模式——重连本身是继续调查的前提,不是写操作)。
      if (call.function.name === 'reconnect_terminal') {
        await executeReconnect(id, call)
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
      // 代理:选代理本身没有副作用(计划模式也允许);询问模式出卡片让用户确认/换一个。
      if (call.function.name === 'use_proxy') {
        const meta = prepareProxy(id, call)
        if (!meta) continue
        const ranked = await rankForCall(id, call, meta)
        if (ranked.length === 0) {
          pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content: noProxyMessage(id, meta) }])
        } else if (useProxyUiStore.getState().agentMode === 'auto') {
          applyProxyChoice(id, call, meta, ranked[0])
        } else {
          anyAsk = true
        }
        continue
      }
      // 等待长任务:只做本地只读检查,任何模式下都允许;等本批其余调用处理完再开始倒计时。
      if (call.function.name === 'wait_and_check') {
        if (pendingWait) {
          pushMsgs(id, [
            {
              role: 'tool',
              tool_call_id: call.id,
              content: '未开始等待: 同一时间只能有一个 wait_and_check,请合并成一个检查命令。'
            }
          ])
          continue
        }
        const prepared = prepareWait(id, call)
        if (prepared) pendingWait = { call, ...prepared }
        continue
      }
      // 补充目标:完全访问 + 唯一匹配时直接连接并勾选,其余出卡片让用户选。
      if (call.function.name === 'request_target') {
        const r = prepareTargetRequest(id, call)
        if (r === 'ask') anyAsk = true
        else if (r) await executeTargetRequest(id, call, r)
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
      if (!resolved && target?.trim()) {
        pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content: unknownTargetMessage(id, target) }])
        continue
      }
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
    if (pendingWait) {
      if (anyAsk) {
        // 还有卡片等用户确认:先别倒计时,让模型在确认之后再发起等待。
        pushMsgs(id, [
          {
            role: 'tool',
            tool_call_id: pendingWait.call.id,
            content: '未开始等待: 本轮还有待用户确认的操作。请在用户确认、任务真正开始后再调用 wait_and_check。'
          }
        ])
      } else if (!stopped[id]) {
        startWait(id, pendingWait.call, pendingWait.args, pendingWait.target)
        return
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
    patch(id, { status: 'streaming', streamingText: '', error: null })
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
      const offErr = window.api.llm.onError(runId, (info) => {
        offDone()
        offErr()
        patch(id, { error: info })
        resolve({ role: 'assistant', content: '' })
      })
      const mode = get().mode
      const proxyCtx = currentProxyContext()
      const sys: ChatMessage = {
        role: 'system',
        content: buildSystemPrompt(targets, mode, proxyCtx)
      }
      window.api.llm.chat(runId, {
        messages: [sys, ...cur(id).messages],
        tools: buildAgentTools(targets, mode, proxyCtx),
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
      // 等待中允许发消息:先结束等待(补上 wait_and_check 的结果,保持消息顺序合法),再处理新消息。
      if (cur(id).status === 'waiting') finishWait(id, 'interrupted', false)
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

    selectProxyOption: (id, callId, proxyId) => patchProxyMeta(id, callId, { selectedId: proxyId }),

    resolveProxy: (id, call, proxyId) => {
      stopped[id] = false
      const meta = cur(id).proxyMeta[call.id]
      const proxy = proxyId
        ? useVaultStore.getState().proxies.find((p) => p.id === proxyId)
        : undefined
      const result = meta && proxy?.checks?.[meta.key]
      if (!meta || !proxy || !result) {
        // 保留「用户已拒绝」前缀 —— 卡片据此显示为说明样式。
        const content = proxyId
          ? '用户已拒绝:所选代理已不存在,未使用代理。请改用其他方案或再次调用 use_proxy。'
          : '用户已拒绝使用代理。请改用其他方案(如更换镜像源)继续,或向用户说明情况。'
        pushMsgs(id, [{ role: 'tool', tool_call_id: call.id, content }])
      } else {
        applyProxyChoice(id, call, meta, { proxy, result })
      }
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

    resolveTargetRequest: async (id, call, choice) => {
      stopped[id] = false
      if (!choice) {
        const meta = cur(id).targetRequestMeta[call.id]
        pushMsgs(id, [
          {
            role: 'tool',
            tool_call_id: call.id,
            content:
              `用户已拒绝补充目标「${meta?.query ?? ''}」。请改用现有目标完成任务,` +
              '或向用户说明为什么需要那台服务器,不要在其他目标上替代执行。'
          }
        ])
      } else {
        await executeTargetRequest(id, call, choice)
      }
      maybeContinue(id)
    },

    retry: (id) => {
      const s = cur(id)
      if (s.status !== 'idle' || s.messages.length === 0) return
      stopped[id] = false
      void runTurn(id)
    },

    checkNow: (id) => {
      const w = cur(id).wait
      if (!w || w.phase === 'checking') return
      void runWaitTick(id)
    },

    endWait: (id) => {
      if (!cur(id).wait) return
      stopped[id] = false
      finishWait(id, 'user_continue', true)
    },

    cancelWait: (id) => {
      if (!cur(id).wait) return
      // 结果照常推回(模型下次被唤醒时知道等待被取消了),但本轮不再续跑。
      finishWait(id, 'user_cancel', false)
    },

    stop: (id) => {
      stopped[id] = true
      if (activeRunId[id]) void window.api.llm.abort(activeRunId[id])
      if (cur(id).wait) finishWait(id, 'user_cancel', false)
      patch(id, { status: 'idle', streamingText: '' })
    },

    reset: (id) => patch(id, { ...EMPTY_AGENT_SESSION })
  }
})
