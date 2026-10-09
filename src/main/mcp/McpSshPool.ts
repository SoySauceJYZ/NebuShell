import { Client, type SFTPWrapper } from 'ssh2'
import type { Host, SshConnectOptions } from '../../shared/types'
import { SAFE_ALGORITHMS, SAFE_KEEPALIVE_INTERVAL } from '../ssh/algorithms'
import { createNoDelaySocket } from '../ssh/createSocket'
import { vaultManager } from '../vault/VaultManager'

/** 空闲多久后回收连接。 */
const IDLE_MS = 10 * 60 * 1000

export interface McpExecResult {
  stdout: string
  stderr: string
  code: number | null
  truncated: boolean
  timedOut: boolean
}

interface PoolEntry {
  client: Client
  sftp: SFTPWrapper | null
  timer: ReturnType<typeof setTimeout> | null
}

/** 与渲染端 resolveConnectOptions 同义:Host + 凭据 → 连接参数。 */
function toConnectOptions(host: Host, credentials: ReturnType<typeof getCredentials>): SshConnectOptions {
  const base: SshConnectOptions = {
    sessionId: `mcp:${host.id}`,
    host: host.address,
    port: host.port,
    username: host.username
  }
  if (host.authType === 'password') return { ...base, password: host.password }
  if (host.authType === 'key') {
    return { ...base, privateKey: host.privateKey, passphrase: host.passphrase }
  }
  if (host.authType === 'credential' && host.credentialId) {
    const cred = credentials.find((c) => c.id === host.credentialId)
    if (cred?.type === 'password') return { ...base, password: cred.password }
    if (cred?.type === 'key') {
      return { ...base, privateKey: cred.privateKey, passphrase: cred.passphrase }
    }
  }
  return base
}

function getCredentials() {
  return vaultManager.getData().credentials
}

/** 保险库已解锁时返回主机列表,否则抛出明确错误。 */
export function listVaultHosts(): Host[] {
  if (!vaultManager.isUnlocked()) throw new Error('NebuShell 保险库未解锁,请先在应用中解锁')
  return vaultManager.getData().hosts
}

/** 按 id 或 label(精确优先、再模糊)找主机;不唯一时报错并列出候选。 */
export function resolveHost(query: string): Host {
  const hosts = listVaultHosts()
  const q = query.trim().toLowerCase()
  const exact = hosts.filter((h) => h.id === query || h.label.toLowerCase() === q)
  if (exact.length === 1) return exact[0]
  const pool =
    exact.length > 1
      ? exact
      : hosts.filter((h) => h.label.toLowerCase().includes(q) || h.address.toLowerCase() === q)
  if (pool.length === 1) return pool[0]
  if (pool.length === 0) throw new Error(`找不到主机「${query}」,请先调用 list_hosts 查看可用主机`)
  throw new Error(
    `「${query}」匹配到多台主机,请改用 id:` +
      pool.map((h) => `${h.label}(${h.id})`).join('、')
  )
}

/**
 * MCP 专用的 SSH 连接池:按 hostId 懒连接、复用、空闲回收。
 * 与终端标签的会话完全独立,不会往用户可见的 shell 里写任何东西。
 */
class McpSshPool {
  private entries = new Map<string, PoolEntry>()
  private pending = new Map<string, Promise<PoolEntry>>()

  private touch(hostId: string): void {
    const e = this.entries.get(hostId)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    e.timer = setTimeout(() => this.drop(hostId), IDLE_MS)
  }

  private drop(hostId: string): void {
    const e = this.entries.get(hostId)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    this.entries.delete(hostId)
    try {
      e.client.end()
    } catch {
      // 已关闭
    }
  }

  private async open(host: Host): Promise<PoolEntry> {
    const opts = toConnectOptions(host, getCredentials())
    const sock = await createNoDelaySocket(opts.host, opts.port)
    return new Promise<PoolEntry>((resolve, reject) => {
      const client = new Client()
      const entry: PoolEntry = { client, sftp: null, timer: null }
      let ready = false
      client
        .on('ready', () => {
          ready = true
          this.entries.set(host.id, entry)
          this.touch(host.id)
          resolve(entry)
        })
        .on('error', (err) => {
          if (!ready) reject(err)
          else if (this.entries.get(host.id) === entry) this.drop(host.id)
        })
        .on('close', () => {
          if (this.entries.get(host.id) === entry) {
            if (entry.timer) clearTimeout(entry.timer)
            this.entries.delete(host.id)
          }
        })
        .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
          finish(opts.password && prompts.length > 0 ? [opts.password] : [])
        })
        .connect({
          sock,
          username: opts.username,
          password: opts.password,
          privateKey: opts.privateKey,
          passphrase: opts.passphrase,
          readyTimeout: 20000,
          tryKeyboard: true,
          algorithms: SAFE_ALGORITHMS,
          keepaliveInterval: SAFE_KEEPALIVE_INTERVAL
        })
    })
  }

  private async acquire(host: Host): Promise<PoolEntry> {
    const existing = this.entries.get(host.id)
    if (existing) {
      this.touch(host.id)
      return existing
    }
    let p = this.pending.get(host.id)
    if (!p) {
      p = this.open(host).finally(() => this.pending.delete(host.id))
      this.pending.set(host.id, p)
    }
    return p
  }

  async exec(
    host: Host,
    command: string,
    opts: { timeoutMs: number; maxBytes: number; stdin?: string }
  ): Promise<McpExecResult> {
    const entry = await this.acquire(host)
    return new Promise<McpExecResult>((resolve, reject) => {
      entry.client.exec(command, (err, stream) => {
        if (err) {
          reject(err)
          return
        }
        let stdout = ''
        let stderr = ''
        let code: number | null = null
        let truncated = false
        let timedOut = false
        const append = (cur: string, chunk: Buffer): string => {
          if (cur.length >= opts.maxBytes) {
            truncated = true
            return cur
          }
          const next = cur + chunk.toString('utf8')
          if (next.length > opts.maxBytes) {
            truncated = true
            return next.slice(0, opts.maxBytes)
          }
          return next
        }
        const timer = setTimeout(() => {
          timedOut = true
          try {
            stream.close()
          } catch {
            // ignore
          }
        }, opts.timeoutMs)
        stream.on('data', (c: Buffer) => (stdout = append(stdout, c)))
        stream.stderr.on('data', (c: Buffer) => (stderr = append(stderr, c)))
        stream.on('exit', (c: number | null) => (code = c))
        stream.on('close', () => {
          clearTimeout(timer)
          this.touch(host.id)
          resolve({ stdout, stderr, code, truncated, timedOut })
        })
        stream.on('error', (e: Error) => {
          clearTimeout(timer)
          reject(e)
        })
        // 经 stdin 传入的内容不会出现在远端进程列表里(用于传递凭据等)。
        if (opts.stdin !== undefined) stream.end(opts.stdin)
      })
    })
  }

  async sftp(host: Host): Promise<SFTPWrapper> {
    const entry = await this.acquire(host)
    if (entry.sftp) return entry.sftp
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
      entry.client.sftp((err, s) => (err ? reject(err) : resolve(s)))
    )
    entry.sftp = sftp
    sftp.on('close', () => {
      if (entry.sftp === sftp) entry.sftp = null
    })
    return sftp
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.drop(id)
  }
}

export const mcpSshPool = new McpSshPool()
