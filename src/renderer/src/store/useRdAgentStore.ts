import { create } from 'zustand'
import type { ChatMessage, ToolCall, RdInputEvent, AgentConversationMeta } from '@shared/types'
import { type AgentMode, disposition, transferDisposition } from '../lib/agentPermissions'
import {
  buildRdAgentTools,
  buildRdSystemPrompt,
  isRiskyComputerAction,
  keyChordToCodes,
  type RdActionName
} from '../lib/rdComputerAgent'
import type { Frame } from '../lib/rdScreenshot'

// 远程桌面「画面操控 Agent」的对话循环。仿 useAgentStore 的 runTurn→processToolCalls→
// maybeContinue,但工具是 GUI 动作:每步给模型一张被控屏截图,模型的坐标(截图像素)在此
// 归一化后经 input 通道注入。截图/注入/发文件由外部传入的 bridge 完成(它持有 <video> 与通道)。

export interface RdAgentBridge {
  /** 抓当前被控屏一帧(降采样)。 */
  capture: () => Frame | null
  /** 发一条注入事件到被控端(走 input DataChannel)。 */
  sendInput: (ev: RdInputEvent) => void
  /** 把控制端本机某路径的文件推送到被控「下载」。 */
  sendFileByPath: (path: string) => Promise<void>
}

export interface RdAgentSession {
  messages: ChatMessage[]
  status: 'idle' | 'streaming' | 'running' | 'awaiting'
  streamingText: string
  runningIds: string[]
  error: string
  convId?: string
  peerKey: string
}

interface State {
  sessions: Record<string, RdAgentSession>
  mode: AgentMode
  activeProviderId?: string
  activeModel?: string
  setMode: (m: AgentMode) => void
  setActiveModel: (providerId: string, model: string) => void
  loadSettings: () => Promise<void>
  ensure: (id: string, peerKey: string) => void
  reset: (id: string) => void
  listConvs: (peerKey: string) => Promise<AgentConversationMeta[]>
  openConv: (id: string, peerKey: string, convId: string) => Promise<void>
  send: (id: string, bridge: RdAgentBridge, goal: string) => void
  resolveAction: (id: string, bridge: RdAgentBridge, call: ToolCall, approve: boolean) => void
  answer: (id: string, bridge: RdAgentBridge, call: ToolCall, text: string) => void
  approvePlan: (id: string, bridge: RdAgentBridge, call: ToolCall, runMode: AgentMode) => void
  stop: (id: string) => void
}

// 运行时标志(不入 React state,循环里同步读)。
const activeRunId: Record<string, string> = {}
const stopped: Record<string, boolean> = {}
/** 每个会话「模型当前看到的截图」尺寸,用于把模型坐标归一化。 */
const lastFrame: Record<string, { w: number; h: number }> = {}

export const useRdAgentStore = create<State>((set, get) => {
  const patch = (id: string, p: Partial<RdAgentSession>): void =>
    set((s) => ({ sessions: { ...s.sessions, [id]: { ...s.sessions[id], ...p } } }))
  const cur = (id: string): RdAgentSession => get().sessions[id]
  const pushMsg = (id: string, m: ChatMessage): void =>
    patch(id, { messages: [...cur(id).messages, m] })

  const persist = (id: string): void => {
    const s = cur(id)
    if (!s?.convId) return
    const title = firstGoal(s.messages) || '远程桌面任务'
    void window.api.agentChat.save(s.peerKey, s.convId, title, stripImages(s.messages))
  }

  const runTurn = async (id: string, bridge: RdAgentBridge): Promise<void> => {
    if (stopped[id]) return
    const { mode, activeProviderId, activeModel } = get()
    patch(id, { status: 'streaming', streamingText: '', error: '' })
    const runId = crypto.randomUUID()
    activeRunId[id] = runId
    const frame = lastFrame[id] ?? { w: 1280, h: 800 }
    const sys: ChatMessage = { role: 'system', content: buildRdSystemPrompt(mode, frame) }

    let acc = ''
    const offDelta = window.api.llm.onDelta(runId, (t) => {
      acc += t
      patch(id, { streamingText: acc })
    })
    const finalMsg = await new Promise<ChatMessage>((resolve) => {
      const offDone = window.api.llm.onDone(runId, (m) => {
        offDelta(); offDone(); offErr()
        resolve(m)
      })
      const offErr = window.api.llm.onError(runId, (msg) => {
        offDelta(); offDone(); offErr()
        patch(id, { error: msg })
        resolve({ role: 'assistant', content: '' })
      })
      window.api.llm.chat(runId, {
        messages: [sys, ...pruneScreenshots(cur(id).messages)],
        tools: buildRdAgentTools(mode),
        providerId: activeProviderId,
        model: activeModel
      })
    })

    if (stopped[id]) return
    patch(id, { streamingText: '' })
    pushMsg(id, finalMsg)
    if (finalMsg.tool_calls && finalMsg.tool_calls.length) {
      await processToolCalls(id, bridge, finalMsg.tool_calls)
    } else {
      patch(id, { status: 'idle' })
    }
    persist(id)
  }

  const processToolCalls = async (
    id: string,
    bridge: RdAgentBridge,
    calls: ToolCall[]
  ): Promise<void> => {
    let anyAsk = false
    let finished = false
    for (const call of calls) {
      if (stopped[id]) return
      const name = call.function.name as RdActionName
      const args = parseArgs(call)
      if (name === 'ask_user' || name === 'present_plan') {
        anyAsk = true // 由卡片处理
        continue
      }
      if (name === 'done') {
        pushMsg(id, toolResult(call, args.summary ? String(args.summary) : '已完成'))
        finished = true
        continue
      }
      if (name === 'transfer_file') {
        const disp = transferDisposition(get().mode, 'upload')
        if (disp === 'auto') await runAction(id, bridge, call, name, args)
        else if (disp === 'block')
          pushMsg(id, toolResult(call, '【计划模式】不传输文件'))
        else anyAsk = true
        continue
      }
      // GUI 动作
      const disp = disposition(get().mode, isRiskyComputerAction(name))
      if (disp === 'auto') await runAction(id, bridge, call, name, args)
      else if (disp === 'block') pushMsg(id, toolResult(call, '【计划模式】不执行操作'))
      else anyAsk = true
    }
    if (finished) {
      patch(id, { status: 'idle' })
      return
    }
    if (anyAsk) patch(id, { status: 'awaiting' })
    else await maybeContinue(id, bridge)
  }

  /** 真正执行一个动作(注入/发文件/等待),并把结果作为 tool 消息写回。 */
  const runAction = async (
    id: string,
    bridge: RdAgentBridge,
    call: ToolCall,
    name: RdActionName,
    args: Record<string, unknown>
  ): Promise<void> => {
    patch(id, { status: 'running', runningIds: [...cur(id).runningIds, call.id] })
    let result = 'ok'
    try {
      result = await executeAction(id, bridge, name, args)
    } catch (e) {
      result = '执行失败:' + String(e)
    }
    patch(id, { runningIds: cur(id).runningIds.filter((x) => x !== call.id) })
    pushMsg(id, toolResult(call, result))
  }

  const executeAction = async (
    id: string,
    bridge: RdAgentBridge,
    name: RdActionName,
    args: Record<string, unknown>
  ): Promise<string> => {
    const fr = lastFrame[id] ?? { w: 1280, h: 800 }
    const nx = (v: unknown): number => clamp01(Number(v) / fr.w)
    const ny = (v: unknown): number => clamp01(Number(v) / fr.h)
    const btn = (b: unknown): number => (b === 'right' ? 2 : b === 'middle' ? 1 : 0)
    switch (name) {
      case 'move_mouse':
        bridge.sendInput({ type: 'move', x: nx(args.x), y: ny(args.y) })
        return `已移动到 (${args.x}, ${args.y})`
      case 'click': {
        const b = btn(args.button)
        bridge.sendInput({ type: 'move', x: nx(args.x), y: ny(args.y) })
        bridge.sendInput({ type: 'down', x: nx(args.x), y: ny(args.y), button: b })
        bridge.sendInput({ type: 'up', x: nx(args.x), y: ny(args.y), button: b })
        return `已点击 (${args.x}, ${args.y})`
      }
      case 'double_click':
        bridge.sendInput({ type: 'double', x: nx(args.x), y: ny(args.y), button: 0 })
        return `已双击 (${args.x}, ${args.y})`
      case 'type_text':
        bridge.sendInput({ type: 'text', text: String(args.text ?? '') })
        return '已键入文本'
      case 'press_key': {
        const codes = keyChordToCodes(String(args.keys ?? ''))
        if (!codes.length) return '无法识别的组合键'
        for (const c of codes) bridge.sendInput({ type: 'key', down: true, code: c })
        for (const c of [...codes].reverse()) bridge.sendInput({ type: 'key', down: false, code: c })
        return `已按下 ${args.keys}`
      }
      case 'scroll': {
        bridge.sendInput({ type: 'move', x: nx(args.x), y: ny(args.y) })
        const amount = Number(args.amount) || 3
        const dy = (args.direction === 'up' ? -1 : 1) * amount * 100
        bridge.sendInput({ type: 'wheel', dx: 0, dy })
        return `已滚动 ${args.direction}`
      }
      case 'wait': {
        const secs = Math.min(10, Math.max(0, Number(args.seconds) || 1))
        await sleep(secs * 1000)
        return `已等待 ${secs}s`
      }
      case 'screenshot':
        return '已截图'
      case 'transfer_file':
        await bridge.sendFileByPath(String(args.path ?? ''))
        return '已发送文件到被控「下载」'
      default:
        return '未知动作'
    }
  }

  const maybeContinue = async (id: string, bridge: RdAgentBridge): Promise<void> => {
    if (stopped[id]) return
    const msgs = cur(id).messages
    const lastAsst = [...msgs].reverse().find((m) => m.role === 'assistant' && m.tool_calls?.length)
    if (!lastAsst?.tool_calls) return
    const resolvedIds = new Set(msgs.filter((m) => m.role === 'tool').map((m) => m.tool_call_id))
    if (!lastAsst.tool_calls.every((c) => resolvedIds.has(c.id))) return
    // 全部动作已有结果 → 附一张最新截图,进入下一轮。
    const frame = bridge.capture()
    if (frame) {
      lastFrame[id] = { w: frame.w, h: frame.h }
      pushMsg(id, screenshotMessage(frame))
    }
    await runTurn(id, bridge)
  }

  return {
    sessions: {},
    mode: 'ask',
    activeProviderId: undefined,
    activeModel: undefined,

    setMode: (m) => set({ mode: m }),
    setActiveModel: (providerId, model) => set({ activeProviderId: providerId, activeModel: model }),
    loadSettings: async () => {
      const s = await window.api.llm.getSettings()
      const providerId = s.activeProviderId ?? s.providers[0]?.id
      const provider = s.providers.find((p) => p.id === providerId)
      const model =
        provider?.models.find((m) => m.id === s.activeModelId)?.name ?? provider?.models[0]?.name
      set({ activeProviderId: providerId, activeModel: model })
    },

    ensure: (id, peerKey) => {
      if (get().sessions[id]) return
      set((st) => ({
        sessions: {
          ...st.sessions,
          [id]: {
            messages: [],
            status: 'idle',
            streamingText: '',
            runningIds: [],
            error: '',
            peerKey
          }
        }
      }))
    },

    reset: (id) => {
      stopped[id] = true
      const peerKey = cur(id)?.peerKey ?? `rd:unknown`
      set((st) => ({
        sessions: {
          ...st.sessions,
          [id]: {
            messages: [],
            status: 'idle',
            streamingText: '',
            runningIds: [],
            error: '',
            peerKey
          }
        }
      }))
      delete lastFrame[id]
    },

    listConvs: (peerKey) => window.api.agentChat.list(peerKey),

    openConv: async (id, peerKey, convId) => {
      const messages = await window.api.agentChat.load(peerKey, convId)
      stopped[id] = true
      delete lastFrame[id]
      set((st) => ({
        sessions: {
          ...st.sessions,
          [id]: {
            ...st.sessions[id],
            messages,
            convId,
            status: 'idle',
            streamingText: '',
            runningIds: [],
            error: ''
          }
        }
      }))
    },

    send: (id, bridge, goal) => {
      const frame = bridge.capture()
      if (!frame) {
        patch(id, { error: '画面未就绪,请等待连接稳定后再试。' })
        return
      }
      lastFrame[id] = { w: frame.w, h: frame.h }
      stopped[id] = false
      const s = cur(id)
      const convId = s.convId ?? crypto.randomUUID()
      if (!s.convId) patch(id, { convId })
      pushMsg(id, {
        role: 'user',
        content: `${goal}\n[screenshot ${frame.w}×${frame.h}]`,
        images: [frame.dataUrl]
      })
      void runTurn(id, bridge)
    },

    resolveAction: (id, bridge, call, approve) => {
      if (approve) {
        const name = call.function.name as RdActionName
        void (async () => {
          await runAction(id, bridge, call, name, parseArgs(call))
          await maybeContinue(id, bridge)
        })()
      } else {
        pushMsg(id, toolResult(call, '用户已拒绝该操作'))
        void maybeContinue(id, bridge)
      }
    },

    answer: (id, bridge, call, text) => {
      pushMsg(id, toolResult(call, text))
      void maybeContinue(id, bridge)
    },

    approvePlan: (id, bridge, call, runMode) => {
      set({ mode: runMode })
      pushMsg(id, toolResult(call, `用户已确认,按「${runMode}」模式执行`))
      void maybeContinue(id, bridge)
    },

    stop: (id) => {
      stopped[id] = true
      if (activeRunId[id]) void window.api.llm.abort(activeRunId[id])
      patch(id, { status: 'idle', streamingText: '' })
    }
  }
})

// ---- helpers ---------------------------------------------------------------

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments || '{}')
  } catch {
    return {}
  }
}

function toolResult(call: ToolCall, content: string): ChatMessage {
  return { role: 'tool', content, tool_call_id: call.id }
}

function screenshotMessage(frame: Frame): ChatMessage {
  return { role: 'user', content: `当前屏幕:[screenshot ${frame.w}×${frame.h}]`, images: [frame.dataUrl] }
}

/** 只在「最后一条带图消息」上保留截图,更早的截图剥成占位文字,控制上下文/token。 */
function pruneScreenshots(messages: ChatMessage[]): ChatMessage[] {
  let lastImg = -1
  messages.forEach((m, i) => {
    if (m.images && m.images.length) lastImg = i
  })
  return messages.map((m, i) =>
    m.images && m.images.length && i !== lastImg
      ? { ...m, images: undefined, content: m.content || '[早前截图已省略]' }
      : m
  )
}

function stripImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.images ? { ...m, images: undefined } : m))
}

function firstGoal(messages: ChatMessage[]): string {
  const u = messages.find((m) => m.role === 'user')
  return u ? u.content.split('\n')[0].slice(0, 40) : ''
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
