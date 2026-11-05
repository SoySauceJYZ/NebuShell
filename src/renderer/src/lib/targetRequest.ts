import type { Host } from '@shared/types'
import type { Tab } from '../store/useSessionStore'
import { buildLocalTarget, type AgentTarget } from './agentTools'

/**
 * 已勾选的终端 → 目标描述符:面板自己的终端排第一,名字取 tab 标题(重名加 #2),本机始终排最后。
 * AgentPanel 与智能体补充目标后都用它,两边算出来的名字必须一致(模型靠名字指定 target)。
 */
export function computeAgentTargets(
  selfId: string,
  attachedIds: string[],
  tabs: Tab[],
  hosts: Host[]
): AgentTarget[] {
  const ordered = [selfId, ...attachedIds.filter((x) => x !== selfId)]
  const seen = new Map<string, number>()
  const local = buildLocalTarget()
  seen.set(local.name, 1)
  const resolved: AgentTarget[] = []
  for (const tid of ordered) {
    const tab = tabs.find((t) => t.id === tid && t.kind === 'terminal')
    if (!tab) continue
    const base = tab.title
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    resolved.push({
      sessionId: tid,
      name: n === 1 ? base : `${base} #${n}`,
      host: hosts.find((h) => h.id === tab.hostId)?.label ?? tab.title,
      // 文件传输要用这些字段建自己的 SFTP / containerFs 会话。
      hostId: tab.hostId,
      containerId: tab.containerId,
      dockerCmd: tab.dockerCmd
    })
  }
  resolved.push(local)
  return resolved
}

/**
 * request_target:模型发现需要操作一台「不在目标里」的服务器时,
 * 在已打开的终端 tab 与主机库里找候选,交给卡片(或完全访问模式下直接)补充进目标。
 */

/** 已打开、但没勾进目标的终端 tab。 */
export interface TabCandidate {
  kind: 'tab'
  tabId: string
  title: string
  hostLabel: string
  address: string
}

/** 主机库里有、但还没打开终端的主机 —— 需要新开 tab 连接。 */
export interface HostCandidate {
  kind: 'host'
  hostId: string
  label: string
  address: string
}

export type TargetCandidate = TabCandidate | HostCandidate

export interface CandidateSearch {
  /** 已经在目标里的匹配项 —— 直接告诉模型用哪个名字即可。 */
  already?: AgentTarget
  candidates: TargetCandidate[]
}

export function candidateKey(c: TargetCandidate): string {
  return c.kind === 'tab' ? `tab:${c.tabId}` : `host:${c.hostId}`
}

export function candidateLabel(c: TargetCandidate): string {
  return c.kind === 'tab' ? c.title : c.label
}

function norm(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * 打分匹配:完全相等 > 前缀 > 包含。query 允许是标签、地址、user@host、host:port。
 * 返回 0 表示不匹配。
 */
function score(query: string, fields: (string | undefined)[]): number {
  const q = norm(query)
  if (!q) return 0
  let best = 0
  for (const f of fields) {
    const v = norm(f)
    if (!v) continue
    if (v === q) best = Math.max(best, 3)
    else if (v.startsWith(q)) best = Math.max(best, 2)
    else if (v.includes(q) || (q.length >= 3 && q.includes(v) && v.length >= 3))
      best = Math.max(best, 1)
  }
  return best
}

function hostFields(h: Host): string[] {
  return [
    h.label,
    h.address,
    `${h.username}@${h.address}`,
    `${h.address}:${h.port}`,
    ...(h.tags ?? [])
  ]
}

export function findTargetCandidates(
  query: string,
  ctx: { tabs: Tab[]; hosts: Host[]; targets: AgentTarget[] }
): CandidateSearch {
  const q = query.replace(/^@/, '').trim()
  const already = ctx.targets.find(
    (t) => norm(t.name) === norm(q) || (norm(t.host) === norm(q) && norm(q) !== '')
  )
  if (already) return { already, candidates: [] }

  const targetSessionIds = new Set(ctx.targets.map((t) => t.sessionId))
  const scored: { c: TargetCandidate; s: number }[] = []
  const hostsWithTab = new Set<string>()

  for (const tab of ctx.tabs) {
    if (tab.kind !== 'terminal' || !tab.hostId) continue
    const host = ctx.hosts.find((h) => h.id === tab.hostId)
    if (targetSessionIds.has(tab.id)) {
      // 已经是目标、名字却没对上(例如模型用的是地址) —— 视为已在目标里。
      if (host && score(q, [tab.title, ...hostFields(host)]) >= 2) {
        const t = ctx.targets.find((x) => x.sessionId === tab.id)
        if (t) return { already: t, candidates: [] }
      }
      hostsWithTab.add(tab.hostId)
      continue
    }
    if (!tab.containerId) hostsWithTab.add(tab.hostId)
    const s = score(q, [tab.title, ...(host ? hostFields(host) : [])])
    if (s > 0) {
      scored.push({
        c: {
          kind: 'tab',
          tabId: tab.id,
          title: tab.title,
          hostLabel: host?.label ?? tab.title,
          address: host ? `${host.username}@${host.address}` : ''
        },
        s: s + 0.5 // 已打开的终端优先于新开连接
      })
    }
  }

  for (const h of ctx.hosts) {
    if (hostsWithTab.has(h.id)) continue
    const s = score(q, hostFields(h))
    if (s > 0) {
      scored.push({
        c: { kind: 'host', hostId: h.id, label: h.label, address: `${h.username}@${h.address}` },
        s
      })
    }
  }

  scored.sort((a, b) => b.s - a.s)
  // 有完全匹配时只保留同分项,免得「web」把 web-1 / web-2 / webhook 全带出来干扰自动选择。
  const top = scored[0]?.s ?? 0
  const keep = top >= 3 ? scored.filter((x) => x.s >= 3) : scored
  return { candidates: keep.slice(0, 8).map((x) => x.c) }
}

/** 卡片「从其他主机选择…」下拉:所有未加入目标的终端 tab + 主机库主机。 */
export function allTargetCandidates(ctx: {
  tabs: Tab[]
  hosts: Host[]
  targets: AgentTarget[]
}): TargetCandidate[] {
  const targetSessionIds = new Set(ctx.targets.map((t) => t.sessionId))
  const out: TargetCandidate[] = []
  for (const tab of ctx.tabs) {
    if (tab.kind !== 'terminal' || !tab.hostId || targetSessionIds.has(tab.id)) continue
    const host = ctx.hosts.find((h) => h.id === tab.hostId)
    out.push({
      kind: 'tab',
      tabId: tab.id,
      title: tab.title,
      hostLabel: host?.label ?? tab.title,
      address: host ? `${host.username}@${host.address}` : ''
    })
  }
  for (const h of ctx.hosts) {
    out.push({ kind: 'host', hostId: h.id, label: h.label, address: `${h.username}@${h.address}` })
  }
  return out
}
