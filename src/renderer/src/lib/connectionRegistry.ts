/**
 * 终端连接状态的旁路通知:TerminalTab 把自己的 status 变化报到这里,
 * TerminalTab 之外的代码(智能体为补充目标而后台新开的终端)可以 await「连上了没有」。
 *
 * 与 reconnectRegistry 互补:那边是「请某个终端重连」,这边是「等某个终端连上」。
 */
export type ConnStatus = 'connecting' | 'connected' | 'error' | 'closed'

interface Entry {
  status: ConnStatus
  error?: string
}

const states = new Map<string, Entry>()
const waiters = new Map<string, Set<(e: Entry) => void>>()

export function reportConnection(sessionId: string, status: ConnStatus, error?: string): void {
  const entry = { status, error }
  states.set(sessionId, entry)
  const set = waiters.get(sessionId)
  if (set) for (const fn of [...set]) fn(entry)
}

/** 当前已知状态;终端尚未挂载过时为 undefined。 */
export function connectionStatus(sessionId: string): ConnStatus | undefined {
  return states.get(sessionId)?.status
}

/** 终端卸载时清理,免得之后同 id 的等待拿到陈旧状态。 */
export function forgetConnection(sessionId: string): void {
  states.delete(sessionId)
  const set = waiters.get(sessionId)
  if (set) for (const fn of [...set]) fn({ status: 'closed', error: '终端标签页已关闭' })
}

/**
 * 等到该终端连接成功。连接失败 / 关闭 / 超时都会 reject,错误信息可直接回给模型。
 * 只把「从 connecting 进入 error/closed」当失败 —— 刚登记时的 closed(尚未挂载)不算。
 */
export function waitForConnected(sessionId: string, timeoutMs: number): Promise<void> {
  const now = states.get(sessionId)
  if (now?.status === 'connected') return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let set = waiters.get(sessionId)
    if (!set) {
      set = new Set()
      waiters.set(sessionId, set)
    }
    const done = (): void => {
      clearTimeout(timer)
      set!.delete(onChange)
      if (set!.size === 0) waiters.delete(sessionId)
    }
    const onChange = (e: Entry): void => {
      if (e.status === 'connected') {
        done()
        resolve()
      } else if (e.status === 'error' || e.status === 'closed') {
        done()
        reject(new Error(e.error || (e.status === 'closed' ? '连接已关闭' : '连接失败')))
      }
    }
    const timer = setTimeout(() => {
      done()
      reject(
        new Error(
          `等待连接超时(${Math.round(timeoutMs / 1000)} 秒),可能需要在终端里手动输入密码或确认主机指纹`
        )
      )
    }, timeoutMs)
    set.add(onChange)
  })
}
