import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { buildConversationDigest } from '../../shared/conversationDigest'
import { PROXY_LOCAL_KEY, type ProxyCheckResult } from '../../shared/types'
import { listAllConversations, loadConversation } from '../ipc/agentChatIpc'
import { monitorCenter } from '../monitorCenter/MonitorCenter'
import { vaultManager } from '../vault/VaultManager'
import { auditLog } from './audit'
import { listVaultHosts, resolveHost } from './McpSshPool'
import { fail, ok, wrap } from './toolkit'

/**
 * 只读的「上下文」类工具:应用内智能体的会话记录、监控中心指标与告警、代理列表。
 * 都是 NebuShell 本地已有的数据,不额外登录服务器(监控快照过期时会采集一次)。
 */

const DEFAULT_READ_CHARS = 20_000
const MAX_READ_CHARS = 100_000

function hostLabels(): Map<string, string> {
  return new Map(listVaultHosts().map((h) => [h.id, h.label]))
}

function iso(ts: number | null | undefined): string | null {
  return ts ? new Date(ts).toISOString() : null
}

function describeCheck(r: ProxyCheckResult | undefined): Record<string, unknown> | null {
  if (!r) return null
  return {
    ok: r.ok,
    checkedAt: iso(r.checkedAt),
    latencyMs: r.latencyMs ?? null,
    exitIp: r.exitIp ?? null,
    country: r.country ?? r.countryCode ?? null,
    probe: r.probe ? { url: r.probe.url, ok: r.probe.ok, status: r.probe.status ?? null } : null,
    error: r.error ?? null
  }
}

export function registerInsightTools(server: McpServer, clientIp: string): void {
  // ---- 智能体会话 ---------------------------------------------------------------

  server.registerTool(
    'list_agent_conversations',
    {
      description:
        '列出 NebuShell 内置智能体的历史会话(每台服务器各自的对话记录),按最近更新排序。' +
        '想接着做应用内智能体没做完的任务、或了解某台机器之前做过什么时用,再用 read_agent_conversation 读内容。',
      inputSchema: {
        host: z.string().optional().describe('只看这台主机的会话'),
        query: z.string().optional().describe('按标题过滤(包含即可)'),
        limit: z.number().int().min(1).max(200).optional().describe('默认 30')
      }
    },
    wrap(
      'list_agent_conversations',
      clientIp,
      (a: { query?: string }) => a.query ?? '',
      async (a: { host?: string; query?: string; limit?: number }) => {
        const labels = hostLabels()
        const hostId = a.host ? resolveHost(a.host).id : undefined
        const q = a.query?.trim().toLowerCase()
        const rows = listAllConversations(Number.MAX_SAFE_INTEGER)
          .filter((c) => (hostId ? c.hostId === hostId : true))
          .filter((c) => (q ? c.title.toLowerCase().includes(q) : true))
          .slice(0, a.limit ?? 30)
          .map((c) => ({
            id: c.id,
            title: c.title,
            host: labels.get(c.hostId) ?? `(远程桌面或已删除的主机 ${c.hostId})`,
            hostId: c.hostId,
            updatedAt: iso(c.updatedAt),
            messages: c.messageCount
          }))
        return ok(rows.length ? JSON.stringify(rows, null, 2) : '没有匹配的会话')
      }
    )
  )

  server.registerTool(
    'read_agent_conversation',
    {
      description:
        '读取一段内置智能体的历史会话,整理成文字记录(用户需求、助手回复、执行过的命令与结果摘要)。' +
        'mode=preview(默认)返回最初需求 + 最近进展;mode=transcript 返回完整记录,可用 offset 分段读取。' +
        '记录反映的是当时的状态,继续操作前请先核实服务器现状。',
      inputSchema: {
        id: z.string().describe('会话 id(见 list_agent_conversations)'),
        host: z.string().optional().describe('可省略;会话 id 重复时用来区分'),
        mode: z.enum(['preview', 'transcript']).optional(),
        offset: z.number().int().min(0).optional().describe('transcript 模式的起始字符位置'),
        max_chars: z
          .number()
          .int()
          .min(1000)
          .max(MAX_READ_CHARS)
          .optional()
          .describe(`transcript 模式每次最多返回的字符数,默认 ${DEFAULT_READ_CHARS}`)
      }
    },
    wrap(
      'read_agent_conversation',
      clientIp,
      (a: { id: string }) => a.id,
      async (a: {
        id: string
        host?: string
        mode?: 'preview' | 'transcript'
        offset?: number
        max_chars?: number
      }) => {
        const labels = hostLabels()
        const hostId = a.host ? resolveHost(a.host).id : undefined
        const meta = listAllConversations(Number.MAX_SAFE_INTEGER).find(
          (c) => c.id === a.id && (!hostId || c.hostId === hostId)
        )
        if (!meta) return fail(`找不到会话 ${a.id},请先调用 list_agent_conversations`)
        const conv = loadConversation(meta.hostId, meta.id)
        if (!conv || !conv.messages.length) return fail('会话为空或已损坏')
        const { text, preview } = buildConversationDigest(conv.messages, {
          hostId: conv.hostId,
          convId: conv.id,
          title: conv.title,
          hostLabel: labels.get(conv.hostId) ?? conv.hostId,
          updatedAt: conv.updatedAt
        })
        if ((a.mode ?? 'preview') === 'preview') {
          const more =
            preview.length < text.length
              ? `\n\n(以上为摘要;完整记录共 ${text.length} 字,用 mode="transcript" 分段读取)`
              : ''
          return ok(preview + more)
        }
        const start = Math.min(a.offset ?? 0, text.length)
        const end = Math.min(text.length, start + (a.max_chars ?? DEFAULT_READ_CHARS))
        const tail =
          end < text.length
            ? `\n\n(第 ${start}–${end} 字 / 共 ${text.length} 字;继续读取请传 offset=${end})`
            : `\n\n(第 ${start}–${end} 字 / 共 ${text.length} 字,已读完)`
        return ok(text.slice(start, end) + tail)
      }
    )
  )

  // ---- 监控中心 -----------------------------------------------------------------

  server.registerTool(
    'host_metrics',
    {
      description:
        '查看服务器的实时资源状况(来自 NebuShell 监控中心):CPU、内存、磁盘、网络、GPU、运行时长、容器数、告警级别。' +
        '传 host 返回单台详情(含 CPU 型号、GPU 列表、各磁盘用量);不传返回所有已启用设备的概览。' +
        '数据超过 30 秒会现场采集一次;刚采集时网络速率等需要两次采样的字段可能为空。',
      inputSchema: { host: z.string().optional() }
    },
    wrap(
      'host_metrics',
      clientIp,
      () => '',
      async (a: { host?: string }) => {
        if (a.host) {
          const host = resolveHost(a.host)
          return ok(JSON.stringify(await monitorCenter.snapshot(host.id), null, 2))
        }
        const list = await monitorCenter.snapshotAll()
        if (!list.length) return ok('监控中心没有启用的设备')
        return ok(JSON.stringify(list, null, 2))
      }
    )
  )

  server.registerTool(
    'monitor_events',
    {
      description:
        '读取监控中心最近的告警 / 事件(设备离线、CPU / 内存 / 磁盘 / GPU 超阈值、恢复等)。',
      inputSchema: {
        host: z.string().optional(),
        level: z.enum(['info', 'warn', 'crit']).optional().describe('只看该级别及以上'),
        limit: z.number().int().min(1).max(300).optional().describe('默认 50')
      }
    },
    wrap(
      'monitor_events',
      clientIp,
      () => '',
      async (a: { host?: string; level?: 'info' | 'warn' | 'crit'; limit?: number }) => {
        const hostId = a.host ? resolveHost(a.host).id : undefined
        const rank = { info: 0, warn: 1, crit: 2 }
        const min = rank[a.level ?? 'info']
        const events = monitorCenter
          .getEvents(300)
          .filter((e) => (hostId ? e.deviceId === hostId : true))
          .filter((e) => rank[e.level] >= min)
          .slice(0, a.limit ?? 50)
          .map((e) => `${new Date(e.t).toISOString()}\t${e.level}\t${e.device}\t${e.msg}`)
        return ok(events.length ? `time\tlevel\tdevice\tmessage\n${events.join('\n')}` : '没有事件')
      }
    )
  )

  // ---- 代理 --------------------------------------------------------------------

  server.registerTool(
    'list_proxies',
    {
      description:
        '列出 NebuShell「代理」页里保存的代理(不含密码)。服务器访问外网失败(GitHub、PyPI、Docker Hub 等超时)时,' +
        '把代理名传给 exec_command / start_job / wait_for 的 proxy 参数。' +
        '传 host 时附带该主机上次的连通性检测结果(remoteCheck),优先选 ok=true 的。',
      inputSchema: { host: z.string().optional() }
    },
    async (a: { host?: string }) => {
      try {
        if (!vaultManager.isUnlocked()) return fail('NebuShell 保险库未解锁,请先在应用中解锁')
        const hostId = a.host ? resolveHost(a.host).id : undefined
        const list = (vaultManager.getData().proxies ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          address: `${p.host}:${p.port}`,
          auth: !!(p.username || p.password),
          remark: p.remark ?? null,
          localCheck: describeCheck(p.checks?.[PROXY_LOCAL_KEY]),
          ...(hostId ? { remoteCheck: describeCheck(p.checks?.[hostId]) } : {})
        }))
        auditLog({ client: clientIp, tool: 'list_proxies', host: a.host, ok: true })
        return ok(
          list.length
            ? JSON.stringify(list, null, 2)
            : '还没有保存任何代理(在 NebuShell「代理」页添加)'
        )
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    }
  )
}
