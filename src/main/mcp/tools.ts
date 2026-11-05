import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SFTPWrapper, FileEntryWithStats, Stats } from 'ssh2'
import { auditLog } from './audit'
import { listVaultHosts, mcpSshPool, resolveHost } from './McpSshPool'
import {
  MAX_OUTPUT,
  PROXY_PLACEHOLDER,
  buildRun,
  dockerCmd,
  fail,
  inTarget,
  maskProxy,
  ok,
  resolveProxy,
  sftpCall,
  shellQuote,
  wrap
} from './toolkit'
import { registerJobTools } from './jobs'
import { registerTransferTools } from './transfer'
import { registerInsightTools } from './insights'

const MAX_READ_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_S = 60
const MAX_TIMEOUT_S = 1800

const containerArg = z
  .string()
  .optional()
  .describe('容器 id 或名称;填写后在该容器内操作(docker exec,自动尝试 sudo -n docker)')

export function createMcpServer(clientIp: string): McpServer {
  const server = new McpServer({ name: 'nebushell', version: '1.1.0' })

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
        '在指定服务器(或其上的容器)执行一条 shell 命令(非交互、无 TTY),返回 stdout/stderr/退出码。' +
        '不要运行需要交互输入的命令(用 -y 等参数)。超过几分钟的任务(下载、构建、打包)请改用 start_job + wait_for。' +
        `需要代理访问外网时传 proxy(见 list_proxies):会自动设置 http_proxy/https_proxy/all_proxy 等环境变量,` +
        `命令里也可以用 ${PROXY_PLACEHOLDER} 代表代理地址(例如 git -c http.proxy=${PROXY_PLACEHOLDER} clone …,不要放在单引号里)。`,
      inputSchema: {
        host: z.string().describe('主机 id 或名称'),
        command: z.string().describe('要执行的命令'),
        cwd: z.string().optional().describe('执行前先 cd 到的目录'),
        container: containerArg,
        proxy: z.string().optional().describe('代理 id 或名称(见 list_proxies)'),
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
      (a: { command: string; container?: string; proxy?: string }) =>
        [
          a.container ? `[${a.container}] ` : '',
          a.command.slice(0, 500),
          a.proxy ? ` (proxy: ${a.proxy})` : ''
        ].join(''),
      async (a: {
        host: string
        command: string
        cwd?: string
        container?: string
        proxy?: string
        timeout_seconds?: number
      }) => {
        const host = resolveHost(a.host)
        const proxy = a.proxy ? resolveProxy(a.proxy) : undefined
        const run = await buildRun(host, {
          command: a.command,
          cwd: a.cwd,
          container: a.container,
          proxy
        })
        const r = await mcpSshPool.exec(host, run.cmd, {
          timeoutMs: (a.timeout_seconds ?? DEFAULT_TIMEOUT_S) * 1000,
          maxBytes: MAX_OUTPUT,
          stdin: run.stdin
        })
        const parts = [`exit_code: ${r.code ?? 'unknown'}`]
        if (r.timedOut) parts.push('(命令超时,已被中断;长任务请改用 start_job)')
        if (r.truncated) parts.push(`(输出超过 ${MAX_OUTPUT} 字符,已截断)`)
        parts.push(`--- stdout ---\n${r.stdout}`)
        if (r.stderr) parts.push(`--- stderr ---\n${r.stderr}`)
        const res = ok(maskProxy(parts.join('\n'), proxy))
        if (r.timedOut || (r.code !== null && r.code !== 0)) res.isError = true
        return res
      }
    )
  )

  server.registerTool(
    'list_directory',
    {
      description:
        '列出服务器(或容器内)某个目录的内容。宿主机走 SFTP,返回 type/size/mtime/name;容器内返回 ls -la 原文。',
      inputSchema: {
        host: z.string(),
        path: z.string().describe('绝对路径'),
        container: containerArg
      }
    },
    wrap(
      'list_directory',
      clientIp,
      (a: { path: string; container?: string }) =>
        (a.container ? `[${a.container}] ` : '') + a.path,
      async (a: { host: string; path: string; container?: string }) => {
        const host = resolveHost(a.host)
        if (a.container) {
          const cmd = await inTarget(host, a.container, 'ls -la -- "$1"', { args: [a.path] })
          const r = await mcpSshPool.exec(host, cmd, { timeoutMs: 30_000, maxBytes: MAX_OUTPUT })
          if (r.code !== 0) return fail(r.stderr || r.stdout || `ls 失败(退出码 ${r.code})`)
          return ok(r.stdout)
        }
        const sftp: SFTPWrapper = await mcpSshPool.sftp(host)
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
      description: `读取服务器(或容器内)的文本文件(上限 ${MAX_READ_BYTES / 1024}KB)。二进制文件请用 download_file。`,
      inputSchema: { host: z.string(), path: z.string(), container: containerArg }
    },
    wrap(
      'read_file',
      clientIp,
      (a: { path: string; container?: string }) =>
        (a.container ? `[${a.container}] ` : '') + a.path,
      async (a: { host: string; path: string; container?: string }) => {
        const host = resolveHost(a.host)
        const tooBig = (size: number | string): ToolResultLike =>
          fail(
            `文件 ${size} 字节,超过读取上限 ${MAX_READ_BYTES};请改用 exec_command(head/tail/grep)或 download_file`
          )
        if (a.container) {
          const cmd = await inTarget(
            host,
            a.container,
            `s=$(wc -c < "$1") || exit 1; if [ "$s" -gt ${MAX_READ_BYTES} ]; then echo "TOO_BIG $s" >&2; exit 3; fi; cat -- "$1"`,
            { args: [a.path] }
          )
          const r = await mcpSshPool.exec(host, cmd, {
            timeoutMs: 30_000,
            maxBytes: MAX_READ_BYTES * 2
          })
          const big = /TOO_BIG (\d+)/.exec(r.stderr)
          if (big) return tooBig(big[1])
          if (r.code !== 0) return fail(r.stderr || `读取失败(退出码 ${r.code})`)
          return ok(r.stdout)
        }
        const sftp: SFTPWrapper = await mcpSshPool.sftp(host)
        const st = await sftpCall<Stats>((cb) => sftp.stat(a.path, cb))
        if ((st.size ?? 0) > MAX_READ_BYTES) return tooBig(st.size)
        const buf = await sftpCall<Buffer>((cb) => sftp.readFile(a.path, cb))
        return ok(buf.toString('utf8'))
      }
    )
  )

  server.registerTool(
    'write_file',
    {
      description:
        '把文本写入服务器(或容器内)的文件(覆盖已有内容;父目录须已存在)。二进制文件或需要建目录时用 upload_file。',
      inputSchema: {
        host: z.string(),
        path: z.string(),
        content: z.string(),
        container: containerArg
      }
    },
    wrap(
      'write_file',
      clientIp,
      (a: { path: string; content: string; container?: string }) =>
        `${a.container ? `[${a.container}] ` : ''}${a.path} (${a.content.length} chars)`,
      async (a: { host: string; path: string; content: string; container?: string }) => {
        const host = resolveHost(a.host)
        const bytes = Buffer.byteLength(a.content, 'utf8')
        if (a.container) {
          const cmd = await inTarget(host, a.container, 'cat > "$1"', {
            interactive: true,
            args: [a.path]
          })
          const r = await mcpSshPool.exec(host, cmd, {
            timeoutMs: 60_000,
            maxBytes: MAX_OUTPUT,
            stdin: a.content
          })
          if (r.code !== 0) return fail(r.stderr || `写入失败(退出码 ${r.code})`)
          return ok(`已写入容器 ${a.container} 内 ${a.path}(${bytes} 字节)`)
        }
        const sftp: SFTPWrapper = await mcpSshPool.sftp(host)
        await sftpCall<void>((cb) =>
          sftp.writeFile(a.path, Buffer.from(a.content, 'utf8'), (e) => cb(e, undefined))
        )
        return ok(`已写入 ${a.path}(${bytes} 字节)`)
      }
    )
  )

  server.registerTool(
    'docker_ps',
    {
      description: '列出服务器上的 Docker 容器(含已停止),自动尝试 docker 与 sudo -n docker。',
      inputSchema: { host: z.string() }
    },
    wrap(
      'docker_ps',
      clientIp,
      () => 'docker ps -a',
      async (a: { host: string }) => {
        const host = resolveHost(a.host)
        const docker = await dockerCmd(host)
        const fmt = `--format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`
        const r = await mcpSshPool.exec(host, `${docker} ps -a ${fmt}`, {
          timeoutMs: 30_000,
          maxBytes: MAX_OUTPUT
        })
        if (r.code !== 0) return fail(r.stderr || '无法访问 docker')
        return ok(`id\tname\timage\tstatus\tports\n${r.stdout}`)
      }
    )
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
        const docker = await dockerCmd(host)
        const cmd = `${docker} logs --tail ${a.tail ?? 200} ${shellQuote(a.container)} 2>&1`
        const r = await mcpSshPool.exec(host, cmd, { timeoutMs: 30_000, maxBytes: MAX_OUTPUT })
        if (r.code !== 0) return fail(r.stdout || r.stderr || '无法读取日志')
        return ok(r.stdout)
      }
    )
  )

  registerJobTools(server, clientIp)
  registerTransferTools(server, clientIp)
  registerInsightTools(server, clientIp)

  return server
}

type ToolResultLike = ReturnType<typeof fail>
