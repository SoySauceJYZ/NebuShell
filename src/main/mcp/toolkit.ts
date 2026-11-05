import type { Host, ProxyEntry } from '../../shared/types'
import { maskSecret, proxyUrl } from '../../shared/proxyUrl'
import { vaultManager } from '../vault/VaultManager'
import { auditLog } from './audit'
import { mcpSshPool } from './McpSshPool'

/** MCP 工具之间共用的小工具:结果包装、审计、引号、容器 / 代理包装。 */

export const MAX_OUTPUT = 100_000
export const PROXY_PLACEHOLDER = '{{proxy}}'

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

export const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
export const fail = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true
})

/** 工具回调的第二个参数里我们只用到取消信号。 */
export interface ToolExtra {
  signal: AbortSignal
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** 统一包一层:记审计、把异常转成 isError 结果。 */
export function wrap<A extends object>(
  tool: string,
  client: string,
  // NoInfer:参数类型只从 fn 推断,summarize 可以只声明它用到的字段。
  summarize: (a: NoInfer<A>) => string,
  fn: (a: A, extra: ToolExtra) => Promise<ToolResult>
): (a: A, extra: ToolExtra) => Promise<ToolResult> {
  return async (a, extra) => {
    const started = Date.now()
    const args = a as { host?: string; source_host?: string; dest_host?: string }
    const host =
      args.host ?? (args.source_host ? `${args.source_host} → ${args.dest_host}` : undefined)
    try {
      const r = await fn(a, extra)
      auditLog({
        client,
        tool,
        host,
        detail: summarize(a),
        ok: !r.isError,
        ms: Date.now() - started
      })
      return r
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      auditLog({ client, tool, host, detail: summarize(a), ok: false, error: msg })
      return fail(msg)
    }
  }
}

export const sftpCall = <T>(
  run: (cb: (err: Error | null | undefined, v: T) => void) => void
): Promise<T> => new Promise((resolve, reject) => run((err, v) => (err ? reject(err) : resolve(v))))

// ---- docker ------------------------------------------------------------------

const DOCKER_TTL_MS = 10 * 60 * 1000
const dockerCache = new Map<string, { cmd: string; at: number }>()

/** 该主机上能用的 docker 命令:docker 或 sudo -n docker。结果缓存 10 分钟。 */
export async function dockerCmd(host: Host): Promise<string> {
  const hit = dockerCache.get(host.id)
  if (hit && Date.now() - hit.at < DOCKER_TTL_MS) return hit.cmd
  const probe =
    'if docker ps -q >/dev/null 2>&1; then echo docker; ' +
    'elif sudo -n docker ps -q >/dev/null 2>&1; then echo "sudo -n docker"; ' +
    'else echo NONE; fi'
  const r = await mcpSshPool.exec(host, probe, { timeoutMs: 20_000, maxBytes: 1000 })
  const cmd = r.stdout.trim().split('\n').pop()?.trim() ?? ''
  if (cmd !== 'docker' && cmd !== 'sudo -n docker') {
    throw new Error(
      '无法访问 docker(docker 与 sudo -n docker 都失败):未安装、未启动或当前用户无权限'
    )
  }
  dockerCache.set(host.id, { cmd, at: Date.now() })
  return cmd
}

/**
 * 把一段 sh 脚本包成在宿主机或容器里执行的命令。
 * interactive 时给 docker exec 加 -i,让 stdin 透传进容器(上传、代理地址都靠它)。
 * args 作为 $1、$2… 传入,路径之类不用再拼进脚本里转义。
 */
export async function inTarget(
  host: Host,
  container: string | undefined,
  script: string,
  opts: { interactive?: boolean; args?: string[] } = {}
): Promise<string> {
  const args = (opts.args ?? []).map(shellQuote).join(' ')
  const sh = `sh -c ${shellQuote(script)} sh${args ? ` ${args}` : ''}`
  if (!container) return sh
  const docker = await dockerCmd(host)
  return `${docker} exec${opts.interactive ? ' -i' : ''} ${shellQuote(container)} ${sh}`
}

// ---- 代理 --------------------------------------------------------------------

function proxyList(): ProxyEntry[] {
  if (!vaultManager.isUnlocked()) throw new Error('NebuShell 保险库未解锁,请先在应用中解锁')
  return vaultManager.getData().proxies ?? []
}

/** 按 id 或名称找代理(精确优先、再模糊);不唯一时报错并列出候选。 */
export function resolveProxy(query: string): ProxyEntry {
  const list = proxyList()
  const q = query.trim().toLowerCase()
  const exact = list.filter((p) => p.id === query || p.name.toLowerCase() === q)
  if (exact.length === 1) return exact[0]
  const pool = exact.length > 1 ? exact : list.filter((p) => p.name.toLowerCase().includes(q))
  if (pool.length === 1) return pool[0]
  if (pool.length === 0)
    throw new Error(`找不到代理「${query}」,请先调用 list_proxies 查看可用代理`)
  throw new Error(
    `「${query}」匹配到多个代理,请改用 id:` + pool.map((p) => `${p.name}(${p.id})`).join('、')
  )
}

/** 代理真实地址;SOCKS5 用 socks5h,让 DNS 也走代理。 */
export function proxyAddress(p: ProxyEntry): string {
  return proxyUrl(p, { remoteDns: true })
}

/**
 * 从变量 NEBU_PROXY 导出常用代理环境变量的脚本片段。
 * 地址本身经 stdin 或文件传入,不出现在命令行(ps 看不到密码)。
 */
export const PROXY_EXPORTS =
  'export NEBU_PROXY http_proxy="$NEBU_PROXY" https_proxy="$NEBU_PROXY" all_proxy="$NEBU_PROXY" ' +
  'HTTP_PROXY="$NEBU_PROXY" HTTPS_PROXY="$NEBU_PROXY" ALL_PROXY="$NEBU_PROXY" ' +
  'no_proxy=localhost,127.0.0.1,::1 NO_PROXY=localhost,127.0.0.1,::1'

/** 命令里的 {{proxy}} → "${NEBU_PROXY}"(由 shell 展开,不把密码写进命令文本)。 */
export function expandProxyPlaceholder(command: string): string {
  return command.split(PROXY_PLACEHOLDER).join('"${NEBU_PROXY}"')
}

export function maskProxy(text: string, p?: ProxyEntry): string {
  return p ? maskSecret(text, p) : text
}

export interface RunSpec {
  command: string
  cwd?: string
  container?: string
  proxy?: ProxyEntry
}

/**
 * exec_command / wait_for 用:组装最终命令。
 * - 无容器无代理:保持原行为,直接交给登录 shell(`cd 目录 && 命令`)。
 * - 有代理:首行 stdin 读入代理地址再 export,命令本身不含密码。
 * - 有容器:整段脚本在 docker exec 里执行。
 */
export async function buildRun(
  host: Host,
  spec: RunSpec
): Promise<{ cmd: string; stdin?: string }> {
  if (spec.command.includes(PROXY_PLACEHOLDER) && !spec.proxy) {
    throw new Error(`命令里用了 ${PROXY_PLACEHOLDER},但没有传 proxy 参数`)
  }
  const cd = spec.cwd ? `cd ${shellQuote(spec.cwd)} || exit 1\n` : ''
  if (!spec.proxy && !spec.container) {
    return { cmd: spec.cwd ? `cd ${shellQuote(spec.cwd)} && ${spec.command}` : spec.command }
  }
  if (!spec.proxy) {
    return { cmd: await inTarget(host, spec.container, cd + spec.command) }
  }
  const script =
    `IFS= read -r NEBU_PROXY\n${PROXY_EXPORTS}\n${cd}` + expandProxyPlaceholder(spec.command)
  return {
    cmd: await inTarget(host, spec.container, script, { interactive: true }),
    stdin: `${proxyAddress(spec.proxy)}\n`
  }
}
