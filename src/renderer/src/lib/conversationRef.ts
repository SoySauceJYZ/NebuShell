import type { Attachment, ChatMessage } from '@shared/types'
import { attachmentFromText } from './attachments'

/**
 * @ 引用历史会话:把一段已保存的智能体对话整理成可读的文字记录,作为附件随消息发给模型。
 * 全文进附件缓存(read_attachment 可检索),随消息走的预览是「最初需求 + 最近部分」——
 * 「继续上次的任务」最需要的是结尾的进展,而不是开头。
 */

export interface ConversationRef {
  hostId: string
  convId: string
  title: string
  /** 来源主机的显示名(主机库标签)。 */
  hostLabel: string
  updatedAt: number
}

/** 预览里「最近部分」的字符预算;开头的最初需求另算(最多 1500 字)。 */
const RECENT_CHARS = 6000
const FIRST_REQUEST_CHARS = 1500
/** 每条工具结果在记录里保留的尾部行数。 */
const RESULT_TAIL_LINES = 4

function argsOf(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function describeCall(name: string, a: Record<string, unknown>): string {
  const target = str(a.target)
  const at = target ? `[${target}]` : ''
  switch (name) {
    case 'run_command':
      return `→ 执行${at}: ${str(a.command)}`
    case 'transfer_file':
      return `→ 传输: ${str(a.source_target)}:${str(a.source_path)} → ${str(a.dest_target)}:${str(a.dest_path)}`
    case 'ask_user':
      return `→ 询问用户: ${str(a.question)}`
    case 'present_plan':
      return `→ 提交方案: ${str(a.title) || '(无标题)'}\n${str(a.plan)}`
    case 'wait_and_check':
      return `→ 等待${at}: ${str(a.reason)}${a.check_command ? `(检查: ${str(a.check_command)})` : ''}`
    case 'request_target':
      return `→ 请求补充目标: ${str(a.query)}(${str(a.reason)})`
    case 'use_proxy':
      return `→ 使用代理${at}: ${str(a.site)}`
    case 'reconnect_terminal':
      return `→ 重连终端${at}`
    default:
      return `→ ${name}`
  }
}

/** 工具结果只留首行(退出码 / 状态)+ 尾部几行,长输出在原会话里看。 */
function summarizeResult(content: string): string {
  const lines = content.split('\n').filter((l) => l.trim())
  if (lines.length <= RESULT_TAIL_LINES + 1) return lines.join('\n')
  const head = lines[0]
  const tail = lines.slice(-RESULT_TAIL_LINES)
  return [head, `…(省略 ${lines.length - 1 - tail.length} 行)`, ...tail].join('\n')
}

function indent(text: string, pad = '   '): string {
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 每条消息一个块;返回块数组,方便按块截取「最近部分」而不切断半条消息。 */
function transcriptBlocks(messages: ChatMessage[]): string[] {
  const results = new Map<string, string>()
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) results.set(m.tool_call_id, m.content)
  }
  const blocks: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const extra = [
        ...(m.images?.length ? [`[附图 ${m.images.length} 张]`] : []),
        ...(m.attachments ?? []).map((a) => `[附件: ${a.name}]`)
      ]
      blocks.push(`【用户】\n${[m.content.trim(), ...extra].filter(Boolean).join('\n')}`)
    } else if (m.role === 'assistant') {
      const parts: string[] = []
      if (m.content.trim()) parts.push(m.content.trim())
      for (const tc of m.tool_calls ?? []) {
        parts.push(describeCall(tc.function.name, argsOf(tc.function.arguments)))
        const r = results.get(tc.id)
        parts.push(r === undefined ? '   (无结果)' : indent(summarizeResult(r)))
      }
      if (parts.length) blocks.push(`【助手】\n${parts.join('\n')}`)
    }
  }
  return blocks
}

export function buildConversationDigest(
  messages: ChatMessage[],
  ref: ConversationRef
): { text: string; preview: string } {
  const header =
    `历史会话「${ref.title}」 · 主机 ${ref.hostLabel} · 最后更新 ${formatTime(ref.updatedAt)} · ` +
    `${messages.length} 条消息`
  const blocks = transcriptBlocks(messages)
  const text = [header, ...blocks].join('\n\n')

  if (text.length <= FIRST_REQUEST_CHARS + RECENT_CHARS) return { text, preview: text }

  // 预览:头部 + 第一条(最初需求)+ 从结尾往前装满预算的若干块。
  const first = blocks[0] ?? ''
  const firstClip =
    first.length > FIRST_REQUEST_CHARS ? `${first.slice(0, FIRST_REQUEST_CHARS)}…` : first
  const recent: string[] = []
  let used = 0
  for (let i = blocks.length - 1; i >= 1; i--) {
    const b = blocks[i]
    if (used + b.length > RECENT_CHARS) {
      // 最后一块也放不下时截它的尾部,保证至少有最近的内容。
      if (recent.length === 0) recent.unshift(`…${b.slice(-RECENT_CHARS)}`)
      break
    }
    recent.unshift(b)
    used += b.length + 2
  }
  const omitted = blocks.length - 1 - recent.length
  const preview = [
    header,
    firstClip,
    ...(omitted > 0 ? [`…(中间省略 ${omitted} 段对话)…`] : []),
    ...recent
  ].join('\n\n')
  return { text, preview }
}

/** 载入被引用的会话并转成附件;会话为空或读取失败时返回 null。 */
export async function conversationAttachment(ref: ConversationRef): Promise<Attachment | null> {
  const messages = await window.api.agentChat.load(ref.hostId, ref.convId)
  if (!messages.length) return null
  const { text, preview } = buildConversationDigest(messages, ref)
  return attachmentFromText(`会话: ${ref.title}`, text, 'conversation', preview)
}
