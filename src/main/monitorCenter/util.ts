import net from 'net'
import { McpSshPool } from '../mcp/McpSshPool'
import type { Host } from '../../shared/types'

/** 监控中心独占的 SSH 连接池:页面关闭时整体回收,不影响 MCP / 终端。 */
export const monitorSshPool = new McpSshPool()

export function safeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? '未知错误')
  return msg.replace(/[\r\n]+/g, ' ').slice(0, 500)
}

export function num(value: unknown): number | null {
  if (value == null || value === '') return null
  if (/^(?:N\/A|\[Not Supported\]|\[N\/A\])$/i.test(String(value).trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function round(value: number | null | undefined, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const p = 10 ** digits
  return Math.round(value * p) / p
}

export class RemoteError extends Error {
  exitCode: number | null
  constructor(message: string, exitCode: number | null) {
    super(message)
    this.exitCode = exitCode
  }
}

/** 执行远程命令;非 0 退出码或超时都视为失败(与原 execSsh 语义一致)。 */
export async function execOk(
  host: Host,
  command: string,
  timeoutMs = 8000,
  maxBytes = 1024 * 1024,
  stdin?: string
): Promise<string> {
  const r = await monitorSshPool.exec(host, command, { timeoutMs, maxBytes, stdin })
  if (r.timedOut)
    throw new RemoteError(`SSH 命令执行超时（${Math.round(timeoutMs / 1000)}秒）`, null)
  if (r.code !== 0 && r.code !== null) {
    const remote = (r.stderr.trim() || r.stdout.trim()).slice(0, 500)
    throw new RemoteError(`远程命令退出码 ${r.code}${remote ? `：${remote}` : ''}`, r.code)
  }
  return r.stdout
}

export function probePort(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let done = false
    const finish = (open: boolean): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** 解析 `__XX_NAME__` 分段输出;NAME 后可带后缀(如容器 id)。 */
export function sections(output: string, prefix: string): Map<string, string> {
  const result = new Map<string, string>()
  const re = new RegExp(`^__${prefix}_([A-Z0-9]+)__(\\S*)\\r?$`, 'gm')
  const marks: { key: string; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(output))) {
    marks.push({ key: m[2] ? `${m[1]}:${m[2]}` : m[1], start: m.index, end: re.lastIndex })
  }
  marks.forEach((mark, i) => {
    const body = output.slice(mark.end, i + 1 < marks.length ? marks[i + 1].start : output.length)
    result.set(mark.key, body.replace(/^\r?\n/, '').replace(/\s+$/, ''))
  })
  return result
}
