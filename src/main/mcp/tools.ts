import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SFTPWrapper, FileEntryWithStats, Stats } from 'ssh2'
import { auditLog } from './audit'
import { listVaultHosts, mcpSshPool, resolveHost } from './McpSshPool'

const MAX_OUTPUT = 100_000
const MAX_READ_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_S = 60
const MAX_TIMEOUT_S = 1800

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

/** 统一包一层:记审计、把异常转成 isError 结果。 */
function wrap<A extends { host?: string }>(
  tool: string,
  client: string,
  summarize: (a: A) => string,
  fn: (a: A) => Promise<ToolResult>
): (a: A) => Promise<ToolResult> {
  return async (a) => {
    const started = Date.now()
    try {
      const r = await fn(a)
      auditLog({
        client,
        tool,
        host: a.host,
        detail: summarize(a),
        ok: !r.isError,
        ms: Date.now() - started
      })
      return r
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      auditLog({ client, tool, host: a.host, detail: summarize(a), ok: false, error: msg })
      return fail(msg)
    }
  }
}

const sftpCall = <T>(run: (cb: (err: Error | null | undefined, v: T) => void) => void): Promise<T> =>
  new Promise((resolve, reject) => run((err, v) => (err ? reject(err) : resolve(v))))

export function createMcpServer(clientIp: string): McpServer {
  const server = new McpServer({ name: 'nebushell', version: '1.0.0' })

  server.registerTool(
    'list_hosts',
    {
      description:
        '列出 NebuShell 中已保存的 SSH 服务器(不含密码/密钥)。其余工具的 host 参数可填这里的 id 或名称。',
      inputSchema: {}
    },
    async () => {
      try {
        const hosts = listVaultHosts().map((h) => ({
          id: h.id,
          label: h.label,
          address: h.address,
          port: h.port,
          username: h.username,
          tags: h.tags
        }))
        auditLog({ client: clientIp, tool: 'list_hosts', ok: true })
        return ok(JSON.stringify(hosts, null, 2))
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    }
  )

  server.registerTool(
    'exec_command',
    {
      description:
        '在指定服务器上执行一条 shell 命令(非交互、无 TTY),返回 stdout/stderr/退出码。不要运行需要交互输入的命令(用 -y 等参数)。',
      inputSchema: {
        host: z.string().describe('主机 id 或名称'),
        command: z.string().describe('要执行的命令'),
        cwd: z.string().optional().describe('执行前先 cd 到的目录'),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(MAX_TIMEOUT_S)
          .optional()
          .describe(`超时秒数,默认 ${DEFAULT_TIMEOUT_S},最大 ${MAX_TIMEOUT_S}`)
      }
    },
    wrap(
      'exec_command',
      clientIp,
      (a: { host: string; command: string }) => a.command.slice(0, 500),
      async (a: { host: string; command: string; cwd?: string; timeout_seconds?: number }) => {
        const host = resolveHost(a.host)
        const cmd = a.cwd ? `cd ${shellQuote(a.cwd)} && ${a.command}` : a.command
        const r = await mcpSshPool.exec(host, cmd, {
          timeoutMs: (a.timeout_seconds ?? DEFAULT_TIMEOUT_S) * 1000,
          maxBytes: MAX_OUTPUT
        })
        const parts = [`exit_code: ${r.code ?? 'unknown'}`]
        if (r.timedOut) parts.push('(命令超时,已被中断)')
        if (r.truncated) parts.push(`(输出超过 ${MAX_OUTPUT} 字符,已截断)`)
        parts.push(`--- stdout ---\n${r.stdout}`)
        if (r.stderr) parts.push(`--- stderr ---\n${r.stderr}`)
        const res = ok(parts.join('\n'))
        if (r.timedOut || (r.code !== null && r.code !== 0)) res.isError = true
        return res
      }
    )
  )

  server.registerTool(
    'list_directory',
    {
      description: '列出服务器上某个目录的内容(SFTP)。',
      inputSchema: { host: z.string(), path: z.string().describe('远端绝对路径') }
    },
    wrap(
      'list_directory',
      clientIp,
      (a: { path: string }) => a.path,
      async (a: { host: string; path: string }) => {
        const sftp: SFTPWrapper = await mcpSshPool.sftp(resolveHost(a.host))
        const list = await sftpCall<FileEntryWithStats[]>((cb) => sftp.readdir(a.path, cb))
        const rows = list.map((i) => {
          const t = i.attrs.isDirectory() ? 'dir' : i.attrs.isSymbolicLink() ? 'link' : 'file'
          const mtime = new Date((i.attrs.mtime ?? 0) * 1000).toISOString()
          return `${t}\t${i.attrs.size ?? 0}\t${mtime}\t${i.filename}`
        })
        return ok(`type\tsize\tmtime\tname\n${rows.join('\n')}`)
      }
    )
  )

  server.registerTool(
    'read_file',
    {
      description: `读取服务器上的文本文件(上限 ${MAX_READ_BYTES / 1024}KB)。`,
      inputSchema: { host: z.string(), path: z.string() }
    },
    wrap(
      'read_file',
      clientIp,
      (a: { path: string }) => a.path,
      async (a: { host: string; path: string }) => {
        const sftp: SFTPWrapper = await mcpSshPool.sftp(resolveHost(a.host))
        const st = await sftpCall<Stats>((cb) => sftp.stat(a.path, cb))
        if ((st.size ?? 0) > MAX_READ_BYTES) {
          return fail(
            `文件 ${st.size} 字节,超过读取上限 ${MAX_READ_BYTES};请改用 exec_command(head/tail/grep)`
          )
        }
        const buf = await sftpCall<Buffer>((cb) => sftp.readFile(a.path, cb))
        return ok(buf.toString('utf8'))
      }
    )
  )

  server.registerTool(
    'write_file',
    {
      description: '把文本写入服务器上的文件(覆盖已有内容;父目录须已存在)。',
      inputSchema: { host: z.string(), path: z.string(), content: z.string() }
    },
    wrap(
      'write_file',
      clientIp,
      (a: { path: string; content: string }) => `${a.path} (${a.content.length} chars)`,
      async (a: { host: string; path: string; content: string }) => {
        const sftp: SFTPWrapper = await mcpSshPool.sftp(resolveHost(a.host))
        await sftpCall<void>((cb) =>
          sftp.writeFile(a.path, Buffer.from(a.content, 'utf8'), (e) => cb(e, undefined))
        )
        return ok(`已写入 ${a.path}(${Buffer.byteLength(a.content, 'utf8')} 字节)`)
      }
    )
  )

  server.registerTool(
    'docker_ps',
    {
      description: '列出服务器上的 Docker 容器(含已停止),自动尝试 docker 与 sudo -n docker。',
      inputSchema: { host: z.string() }
    },
    wrap('docker_ps', clientIp, () => 'docker ps -a', async (a: { host: string }) => {
      const host = resolveHost(a.host)
      const fmt = `--format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`
      const opts = { timeoutMs: 30_000, maxBytes: MAX_OUTPUT }
      let r = await mcpSshPool.exec(host, `docker ps -a ${fmt}`, opts)
      if (r.code !== 0) r = await mcpSshPool.exec(host, `sudo -n docker ps -a ${fmt}`, opts)
      if (r.code !== 0) return fail(r.stderr || '无法访问 docker')
      return ok(`id\tname\timage\tstatus\tports\n${r.stdout}`)
    })
  )

  server.registerTool(
    'docker_logs',
    {
      description: '读取容器日志的末尾若干行。',
      inputSchema: {
        host: z.string(),
        container: z.string().describe('容器 id 或名称'),
        tail: z.number().int().min(1).max(5000).optional().describe('行数,默认 200')
      }
    },
    wrap(
      'docker_logs',
      clientIp,
      (a: { container: string }) => a.container,
      async (a: { host: string; container: string; tail?: number }) => {
        const host = resolveHost(a.host)
        const cmd = `logs --tail ${a.tail ?? 200} ${shellQuote(a.container)} 2>&1`
        const opts = { timeoutMs: 30_000, maxBytes: MAX_OUTPUT }
        let r = await mcpSshPool.exec(host, `docker ${cmd}`, opts)
        if (r.code !== 0) r = await mcpSshPool.exec(host, `sudo -n docker ${cmd}`, opts)
        if (r.code !== 0) return fail(r.stdout || r.stderr || '无法读取日志')
        return ok(r.stdout)
      }
    )
  )

  return server
}
