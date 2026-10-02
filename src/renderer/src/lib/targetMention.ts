import type { AgentTarget } from './agentTools'

/**
 * 输入框里「@ 引用目标」的纯逻辑部分(菜单本身在 components/agent/TargetMention.tsx)。
 * 插进草稿的是目标的名字原文 —— 那串名字正是 run_command 的 `target` 枚举值,
 * 模型拿到就知道该在哪台机器上动手,不必再猜。
 */

export interface MentionState {
  /** '@' 在文本里的下标。 */
  start: number
  /** '@' 与光标之间已经敲下的过滤词。 */
  query: string
}

/** 过滤词最长多少个字符仍当作一次引用 —— 再长基本就是正文了,收起菜单。 */
const MAX_QUERY = 40

/**
 * 从「当前文本 + 光标位置」判断是否正处在一次 @ 引用里。
 * 只认行首或空白之后的 @,免得把 user@host、邮箱地址误判成引用。
 */
export function detectMention(value: string, caret: number): MentionState | null {
  const start = value.lastIndexOf('@', Math.max(0, caret - 1))
  if (start < 0) return null
  const before = start > 0 ? value[start - 1] : ''
  if (before && !/\s/.test(before)) return null
  const query = value.slice(start + 1, caret)
  if (query.length > MAX_QUERY || /[\r\n]/.test(query)) return null
  return { start, query }
}

/**
 * 按过滤词挑目标。名字与主机都参与匹配,且**不**因为过滤词里有空格就放弃 ——
 * 终端标题本来就可能带空格,一律砍掉的话那些目标就永远选不中了。
 * 没有任何命中时调用方会收起菜单,所以正文里的 "@" 不会一直挂着一个空框。
 */
export function matchTargets(targets: AgentTarget[], query: string): AgentTarget[] {
  const q = query.trim().toLowerCase()
  if (!q) return targets
  return targets.filter((t) => t.name.toLowerCase().includes(q) || t.host.toLowerCase().includes(q))
}
