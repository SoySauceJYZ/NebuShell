import type { ChatMessage } from '@shared/types'

/**
 * 上下文用量估算(供智能体面板显示"已用 / 窗口"用)。
 *
 * 前端拿不到真实分词器,这里用一个偏保守的启发式:CJK/全角字符约 1 token/字,
 * 其余约 1 token/4 字符。宁可略高估,也不要让用户在真正溢出前毫无察觉。
 * 因此界面上一律以 "≈" 标注,强调这是估算而非精确计数。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (
      (c >= 0x3000 && c <= 0x9fff) || // CJK 及标点
      (c >= 0xf900 && c <= 0xfaff) || // CJK 兼容
      (c >= 0xff00 && c <= 0xffef) // 全角
    ) {
      cjk++
    }
  }
  const rest = text.length - cjk
  return Math.ceil(cjk + rest / 4)
}

// 一张缩放后(最长边 ≤1568)的图片在主流视觉模型里大致就是这个量级,按上限估。
const TOKENS_PER_IMAGE = 1600

/** 估算一组消息的 token 数(含 role 包裹、图片、附件与 tool_calls 参数的开销)。 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += 4 // 每条消息的 role/包裹固定开销
    if (m.content) total += estimateTokens(m.content)
    if (m.images) total += m.images.length * TOKENS_PER_IMAGE
    // 附件只有 preview 会进上下文(其余靠 read_attachment 按需取),这里也只算 preview。
    if (m.attachments) {
      for (const a of m.attachments) total += estimateTokens(a.preview) + 16
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += 4 + estimateTokens(tc.function.name) + estimateTokens(tc.function.arguments)
      }
    }
  }
  return total
}

// 常见模型的上下文窗口(按模型名子串匹配)。未命中时用默认值。
const WINDOW_TABLE: [RegExp, number][] = [
  [/gpt-4\.1|gpt-4o|gpt-4-turbo|o[1345]\b|o[1345]-/, 128000],
  [/gpt-3\.5/, 16385],
  [/claude/, 200000],
  [/gemini[-_]?(1\.5|2|2\.5|exp)|gemini/, 1000000],
  [/deepseek/, 65536],
  [/qwen|qwq/, 131072],
  [/(llama[-_]?3)|llama3/, 128000],
  [/moonshot|kimi/, 131072],
  [/glm[-_]?4/, 128000],
  [/yi[-_]/, 200000],
  [/mixtral|mistral/, 32768]
]

const DEFAULT_WINDOW = 128000

/** 按模型名推断上下文窗口大小;识别不出则回落到默认值。 */
export function guessContextWindow(modelName?: string): number {
  if (!modelName) return DEFAULT_WINDOW
  const n = modelName.toLowerCase()
  for (const [re, w] of WINDOW_TABLE) if (re.test(n)) return w
  return DEFAULT_WINDOW
}

/** 把 token 数压成紧凑显示,如 12345 → "12.3k"。 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
