import type { ToolCall } from '@shared/types'
import {
  formatDuration,
  judgeCheck,
  tailLines,
  validatePattern,
  type CheckResult
} from '@shared/waitCheck'
import { isLocalTarget, WAIT_LIMITS, type AgentTarget } from './agentTools'
import { shellQuotePath } from './pathUtils'

export { formatDuration, judgeCheck, tailLines, type CheckResult }

/**
 * wait_and_check 的纯逻辑:参数解析、在目标上跑一次检查、判定结果、拼回给模型的文本。
 * 计时器与会话状态在 useAgentStore 里。
 */

export interface WaitArgs {
  reason: string
  target?: string
  command?: string
  intervalSec: number
  maxWaitSec: number
  doneExit?: number
  donePattern?: string
  failPattern?: string
}

/** 会话上的等待状态(倒计时条据此渲染)。 */
export interface WaitState {
  callId: string
  reason: string
  targetName: string
  command?: string
  intervalSec: number
  startedAt: number
  deadline: number
  /** 下一次检查的时间点(倒计时目标)。 */
  nextAt: number
  ticks: number
  phase: 'counting' | 'checking'
  lastOutput: string
  lastExitCode: number | null
  lastCheckedAt?: number
  /** 连续执行失败(连接断开 / 超时)的次数,到 3 次放弃等待。 */
  errors: number
  doneExit?: number
  donePattern?: string
  failPattern?: string
}

export type WaitOutcome =
  | 'done'
  | 'failed'
  | 'timeout'
  | 'error'
  | 'slept'
  | 'user_continue'
  | 'user_cancel'
  | 'interrupted'

export const MAX_CHECK_ERRORS = 3
/** 单次检查的远端超时(秒)与渲染层兜底超时(毫秒)。 */
const CHECK_REMOTE_TIMEOUT = 30
const CHECK_LOCAL_TIMEOUT_MS = 45_000

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function parseWaitArgs(
  call: ToolCall
): { ok: true; args: WaitArgs } | { ok: false; error: string } {
  let a: Record<string, unknown>
  try {
    a = JSON.parse(call.function.arguments || '{}')
  } catch {
    return { ok: false, error: '参数不是合法的 JSON。' }
  }
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d
  const command =
    typeof a.check_command === 'string' && a.check_command.trim()
      ? a.check_command.trim()
      : undefined
  const done = (a.done_when && typeof a.done_when === 'object' ? a.done_when : {}) as Record<
    string,
    unknown
  >
  const fail = (a.fail_when && typeof a.fail_when === 'object' ? a.fail_when : {}) as Record<
    string,
    unknown
  >
  const donePattern =
    typeof done.output_matches === 'string' && done.output_matches ? done.output_matches : undefined
  const failPattern =
    typeof fail.output_matches === 'string' && fail.output_matches ? fail.output_matches : undefined
  let doneExit = typeof done.exit_code === 'number' ? done.exit_code : undefined
  // 有检查命令但没给完成条件:默认退出码 0 即完成(test -f / ! pgrep 这类命令天然如此)。
  if (command && doneExit === undefined && !donePattern) doneExit = 0
  for (const [p, f] of [
    [donePattern, 'done_when.output_matches'],
    [failPattern, 'fail_when.output_matches']
  ] as const) {
    if (p) {
      const err = validatePattern(p, f)
      if (err) return { ok: false, error: err }
    }
  }
  const intervalSec = Math.round(
    clamp(
      num(a.interval_seconds, WAIT_LIMITS.defaultInterval),
      WAIT_LIMITS.minInterval,
      WAIT_LIMITS.maxInterval
    )
  )
  const maxWaitSec = Math.round(
    clamp(num(a.max_wait_seconds, WAIT_LIMITS.defaultMaxWait), intervalSec, WAIT_LIMITS.maxWait)
  )
  return {
    ok: true,
    args: {
      reason: typeof a.reason === 'string' && a.reason.trim() ? a.reason.trim() : '等待任务完成',
      target: typeof a.target === 'string' ? a.target : undefined,
      command,
      intervalSec,
      maxWaitSec,
      doneExit,
      donePattern,
      failPattern
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`检查命令 ${Math.round(ms / 1000)} 秒未返回`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/**
 * 在目标上跑一次检查。SSH / 容器走独立的 exec 通道(ssh.execFull),
 * **不经过用户可见的 PTY** —— 不会 Ctrl-C 掉用户正在终端里做的事,也不会刷屏。
 */
export async function runCheck(target: AgentTarget, command: string): Promise<CheckResult> {
  if (isLocalTarget(target)) {
    const r = await withTimeout(window.api.local.exec(command), CHECK_LOCAL_TIMEOUT_MS)
    return { output: r.output, exitCode: r.exitCode }
  }
  const inner = target.containerId
    ? `${target.dockerCmd || 'docker'} exec ${shellQuotePath(target.containerId)} sh -c ${shellQuotePath(command)}`
    : `sh -c ${shellQuotePath(command)}`
  // 有 coreutils timeout 就用它兜住远端;没有(极简系统)就裸跑,渲染层仍有兜底超时。
  const wrapped =
    `if command -v timeout >/dev/null 2>&1; then timeout ${CHECK_REMOTE_TIMEOUT} ${inner}; ` +
    `else ${inner}; fi`
  const r = await withTimeout(
    window.api.ssh.execFull(target.sessionId, wrapped),
    CHECK_LOCAL_TIMEOUT_MS
  )
  const output = [r.stdout, r.stderr].filter((s) => s && s.trim()).join('\n')
  return { output, exitCode: r.code }
}

const OUTCOME_LABEL: Record<WaitOutcome, string> = {
  done: '条件满足',
  failed: '检测到失败特征',
  timeout: '已达最长等待时间',
  error: '检查命令连续执行失败',
  slept: '等待时间到',
  user_continue: '用户提前结束等待',
  user_cancel: '用户取消了等待',
  interrupted: '用户发送了新消息,等待已中止'
}

/** 等待结束后回给模型的 tool 结果。 */
export function waitResultText(w: WaitState, outcome: WaitOutcome, now = Date.now()): string {
  const head =
    `[等待结束: ${OUTCOME_LABEL[outcome]}] ${w.reason} · 目标 ${w.targetName} · ` +
    `耗时 ${formatDuration(now - w.startedAt)}` +
    (w.command ? ` · 共检查 ${w.ticks} 次` : '')
  const lines = [head]
  if (w.command && w.ticks > 0) {
    lines.push(`最后一次检查(退出码 ${w.lastExitCode ?? '未知'}):`)
    lines.push(tailLines(w.lastOutput, 20) || '(无输出)')
  }
  if (outcome === 'timeout') {
    lines.push('任务可能仍在运行:先查看日志判断进度,需要时可再次调用 wait_and_check 继续等待。')
  } else if (outcome === 'error') {
    lines.push('检查命令无法执行(终端可能已断开),请先确认目标连接状态。')
  } else if (outcome === 'user_cancel') {
    lines.push('请停止当前任务的后续步骤,向用户简要说明当前进度,等待用户指示。')
  } else if (outcome === 'interrupted') {
    lines.push('请优先处理用户的新消息;后台任务可能仍在运行。')
  }
  return lines.join('\n')
}
