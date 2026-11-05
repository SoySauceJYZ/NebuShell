/**
 * 「等待 + 周期检查」的纯判定逻辑。应用内智能体的 wait_and_check(渲染层)
 * 与 MCP 的 wait_for(主进程)共用,两边判定规则保持一致。
 */

export interface CheckConditions {
  /** 退出码等于该值即视为完成。 */
  doneExit?: number
  /** 输出匹配该正则(忽略大小写、多行)即视为完成。 */
  donePattern?: string
  /** 输出匹配该正则即视为失败(优先于完成条件)。 */
  failPattern?: string
}

export interface CheckResult {
  output: string
  exitCode: number | null
}

/** 校验正则;合法返回 null,否则返回可直接回给模型的错误说明。 */
export function validatePattern(pattern: string, field: string): string | null {
  if (pattern.length > 500) return `${field} 正则过长(最多 500 字符)。`
  try {
    new RegExp(pattern, 'im')
    return null
  } catch (e) {
    return `${field} 不是合法的正则: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** 根据一次检查的结果判定:完成 / 失败 / 继续等。 */
export function judgeCheck(w: CheckConditions, r: CheckResult): 'done' | 'failed' | 'continue' {
  if (w.failPattern && new RegExp(w.failPattern, 'im').test(r.output)) return 'failed'
  if (w.doneExit !== undefined && r.exitCode === w.doneExit) return 'done'
  if (w.donePattern && new RegExp(w.donePattern, 'im').test(r.output)) return 'done'
  return 'continue'
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

/** 输出的最后 N 行(给模型 / 倒计时条展开区用)。 */
export function tailLines(text: string, n: number, maxChars = 3000): string {
  const lines = text.replace(/\r/g, '').split('\n')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const out = lines.slice(-n).join('\n')
  return out.length > maxChars ? `…${out.slice(-maxChars)}` : out
}
