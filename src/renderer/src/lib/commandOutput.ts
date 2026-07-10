/**
 * 命令输出入模型的策略层(L1–L4)。
 *
 * 设计目标:模型需要的是"结论 + 错误",不是"过程流水"。因此命令输出不整段塞进上下文,
 * 而是经过:去噪(L1)→ 预算裁剪(L2,尾部优先)→ 元信息头(L3),并把完整输出留在本地
 * 供按需分页检索(L4,read_command_output 工具)。
 *
 * L0(折叠刷新帧)已在采集层 SshManager 完成,这里拿到的 output 已是"人眼看到的那一屏"。
 */

// ---- 可调参数 ----------------------------------------------------------------
/** 失败/超时命令的字符预算(错误信息值钱,给得宽些)。 */
const BUDGET_FAIL = 8000
/** 成功命令的字符预算(基本只需知道"成了",给得紧)。 */
const BUDGET_OK = 2000
/** 截断时保留的头部行数(给点上下文)。 */
const HEAD_LINES = 30
/** 截断时保留的尾部行数(退出码/报错几乎都在结尾,给得多)。 */
const TAIL_LINES = 120
/** 连续重复行达到该数量才折叠。 */
const COLLAPSE_MIN = 5
/** 分页存储最多保留多少条命令的完整输出。 */
const STORE_CAP = 60
/** 分页检索单次返回的硬上限,避免二次刷屏。 */
const READ_MAX = 12000

import type { ShellRunState } from '@shared/types'

// ---- L4:完整输出的本地存储 --------------------------------------------------
interface SavedOutput {
  output: string
  exitCode: number | null
  timedOut: boolean
  name: string
  state?: ShellRunState
  note?: string
}

// 完整输出只留在渲染进程内存里(不进模型、不进持久化),按 ref 索引,LRU 上限。
const store = new Map<string, SavedOutput>()

function shortRef(): string {
  let r = ''
  do {
    r = Math.random().toString(36).slice(2, 8)
  } while (store.has(r))
  return r
}

/** 保存一条命令的完整输出,返回可供模型引用的短标记 ref。 */
export function saveCommandOutput(data: SavedOutput): string {
  const ref = shortRef()
  store.set(ref, data)
  while (store.size > STORE_CAP) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  return ref
}

export interface ReadOptions {
  grep?: string
  head?: number
  tail?: number
  range?: [number, number]
}

/** L4:按需检索已保存的完整输出(grep / 头 / 尾 / 行号区间)。 */
export function readSavedOutput(ref: string, opts: ReadOptions): string {
  const saved = store.get(ref)
  if (!saved) {
    return `未找到 #${ref} 对应的输出(可能已被新命令挤出缓存)。如仍需要,请重新执行该命令。`
  }
  const all = saved.output.split('\n')
  let picked = all
  let desc = ''

  if (opts.grep) {
    const q = opts.grep
    let match: (l: string) => boolean
    try {
      const re = new RegExp(q, 'i')
      match = (l) => re.test(l)
    } catch {
      const low = q.toLowerCase()
      match = (l) => l.toLowerCase().includes(low)
    }
    picked = all.filter(match)
    desc = `grep /${q}/i`
  }
  if (opts.range) {
    const [a, b] = opts.range
    picked = picked.slice(Math.max(0, a - 1), b)
    desc = `行 ${a}-${b}`
  } else if (typeof opts.head === 'number') {
    picked = picked.slice(0, opts.head)
    desc = `头 ${opts.head} 行`
  } else if (typeof opts.tail === 'number') {
    picked = picked.slice(-opts.tail)
    desc = `尾 ${opts.tail} 行`
  }

  let text = picked.join('\n')
  let clipped = ''
  if (text.length > READ_MAX) {
    text = text.slice(0, READ_MAX)
    clipped = '\n…(结果仍过长已截断;请用更精确的 grep 或行号区间缩小范围)'
  }
  const head = `#${ref} 检索结果${desc ? `(${desc})` : ''} · 命中 ${picked.length}/${all.length} 行`
  return `${head}\n${text || '(无匹配)'}${clipped}`
}

// ---- L1:行级去噪(折叠连续重复行) ------------------------------------------
function collapseRuns(lines: string[]): { lines: string[]; collapsed: number } {
  const out: string[] = []
  let collapsed = 0
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    while (j < lines.length && lines[j] === lines[i]) j++
    const run = j - i
    if (run >= COLLAPSE_MIN) {
      out.push(lines[i], `  …(重复 ${run} 行,已折叠)`)
      collapsed += run - 1
    } else {
      for (let k = i; k < j; k++) out.push(lines[k])
    }
    i = j
  }
  return { lines: out, collapsed }
}

// ---- L2 + L3:预算裁剪 + 元信息头 --------------------------------------------
export interface ClampInput {
  output: string
  exitCode: number | null
  timedOut: boolean
  name: string
  /** saveCommandOutput 返回的短标记,用于在截断提示里引导模型分页检索。 */
  ref: string
  /** 终端执行终局状态;缺省视为 completed(向后兼容)。 */
  state?: ShellRunState
  /** 中断/卡死时的可读诊断,原样透给模型帮助其决策。 */
  note?: string
}

function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 把一条命令的输出整理成"喂给模型"的文本:
 * 头部固定给退出码/终端;正文按预算裁剪(尾部优先),截断时告知总量与 #ref。
 */
export function clampCommandOutput({
  output,
  exitCode,
  timedOut,
  name,
  ref,
  state = 'completed',
  note
}: ClampInput): string {
  const rc = exitCode == null ? '未知' : String(exitCode)
  const stateLabel =
    state === 'interrupted'
      ? ' (已自动中断并恢复终端)'
      : state === 'stuck'
        ? ' (终端卡死,建议重连)'
        : timedOut
          ? ' (超时)'
          : ''
  const noteLine = note ? `\n说明: ${note}` : ''
  const statusHead = `[终端: ${name}] 退出码: ${rc}${stateLabel}${noteLine}`
  const raw = output ?? ''
  if (!raw.trim()) return `${statusHead}\n(无输出)`

  const succeeded = exitCode === 0 && state === 'completed'
  const budget = succeeded ? BUDGET_OK : BUDGET_FAIL

  const originalLines = raw.split('\n')
  const { lines, collapsed } = collapseRuns(originalLines)
  const joined = lines.join('\n')

  // 预算内:直接给全量(带一点折叠提示即可)。
  if (joined.length <= budget) {
    const note =
      collapsed > 0 ? ` · 已折叠 ${collapsed} 行重复(原始 ${originalLines.length} 行)` : ''
    return `${statusHead}${note}\n${joined}`
  }

  // 超预算:按字符预算做头尾保留(尾部优先),中间省略。
  // 头部只占约 1/4 预算给点上下文,其余额度全给尾部(退出码/报错在结尾)。
  const META_RESERVE = 200
  const head: string[] = []
  const headBudget = Math.floor(budget * 0.25)
  let headUsed = 0
  for (let i = 0; i < Math.min(HEAD_LINES, lines.length); i++) {
    const cost = lines[i].length + 1
    if (headUsed + cost > headBudget) break
    head.push(lines[i])
    headUsed += cost
  }
  const tail: string[] = []
  const tailBudget = budget - headUsed - META_RESERVE
  let tailUsed = 0
  for (let i = lines.length - 1; i >= head.length && tail.length < TAIL_LINES; i--) {
    const cost = lines[i].length + 1
    if (tailUsed + cost > tailBudget) break
    tail.unshift(lines[i])
    tailUsed += cost
  }
  const omitted = lines.length - head.length - tail.length

  const meta =
    `[输出过长已截断 · 原始 ${originalLines.length} 行 / ${bytesLabel(raw.length)}` +
    `${collapsed > 0 ? ` · 折叠 ${collapsed} 行重复` : ''}` +
    ` · 显示头 ${head.length}/尾 ${tail.length} 行` +
    ` · 需要完整内容时用 read_command_output 检索 #${ref}(可 grep 关键字/取行号区间)]`

  const parts: string[] = [statusHead]
  if (head.length) parts.push(head.join('\n'))
  parts.push(`…… 省略中间 ${omitted} 行 ……`)
  parts.push(tail.join('\n'))
  parts.push(meta)
  return parts.join('\n')
}
