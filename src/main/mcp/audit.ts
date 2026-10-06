import { app } from 'electron'
import { appendFileSync, statSync, renameSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const MAX_BYTES = 5 * 1024 * 1024

export function auditLogPath(): string {
  return join(app.getPath('userData'), 'mcp-audit.log')
}

/** 追加一行 jsonl 审计记录;超过 5MB 时滚动为 .1。写失败不影响主流程。 */
export function auditLog(entry: Record<string, unknown>): void {
  try {
    const file = auditLogPath()
    mkdirSync(dirname(file), { recursive: true })
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`)
    } catch {
      // 文件还不存在
    }
    appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n')
  } catch {
    // 审计失败不应拖垮工具调用
  }
}
