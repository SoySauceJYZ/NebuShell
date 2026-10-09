import { create } from 'zustand'
import {
  PROXY_LOCAL_KEY,
  type AgentProxyMode,
  type ProxyCheckResult,
  type ProxyEntry,
  type ProxyType
} from '@shared/types'
import { useVaultStore } from '../store/useVaultStore'
import { isLocalTarget, type AgentTarget } from './agentTools'

export type NewProxy = Omit<ProxyEntry, 'id' | 'createdAt'>

export const PROXY_TYPE_LABEL: Record<ProxyType, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  socks5: 'SOCKS5'
}

// ---- 解析 / 格式化 ------------------------------------------------------------

const SCHEME_TYPE: Record<string, ProxyType> = {
  http: 'http',
  https: 'https',
  socks: 'socks5',
  socks5: 'socks5',
  socks5h: 'socks5'
}

const validPort = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 65535
const validHost = (h: string): boolean => /^[\w.\-:[\]]+$/.test(h)

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * 解析一行代理。支持:
 *   socks5://user:pass@1.2.3.4:1080   http://1.2.3.4:8080   (scheme 可为 http/https/socks5/socks5h)
 *   1.2.3.4:8080   1.2.3.4:8080:user:pass   user:pass@1.2.3.4:8080   1.2.3.4 8080 user pass
 * 行尾 `#xxx` 作为备注。无 scheme 时用 defaultType。返回 null 表示无法识别。
 */
export function parseProxyLine(raw: string, defaultType: ProxyType = 'http'): NewProxy | null {
  let line = raw.trim()
  if (!line) return null
  let remark: string | undefined
  const hash = line.indexOf('#')
  if (hash !== -1) {
    remark = line.slice(hash + 1).trim() || undefined
    line = line.slice(0, hash).trim()
  }

  const build = (
    type: ProxyType,
    host: string,
    port: number,
    username?: string,
    password?: string
  ): NewProxy | null => {
    host = host.replace(/^\[|\]$/g, '')
    if (!host || !validHost(host) || !validPort(port)) return null
    return {
      name: remark ?? (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`),
      type,
      host,
      port,
      username: username || undefined,
      password: password || undefined,
      remark: undefined
    }
  }

  const scheme = line.match(/^([a-z0-9]+):\/\//i)
  if (scheme) {
    const type = SCHEME_TYPE[scheme[1].toLowerCase()]
    if (!type) return null
    try {
      // 非标准 scheme 也能被 URL 正确拆出用户名/密码/主机/端口。
      const u = new URL(line.replace(/^[a-z0-9]+:/i, 'http:'))
      return build(
        type,
        u.hostname,
        Number(u.port || (type === 'socks5' ? 1080 : 8080)),
        safeDecode(u.username),
        safeDecode(u.password)
      )
    } catch {
      return null
    }
  }

  const at = line.lastIndexOf('@')
  if (at !== -1) {
    const [user, ...pw] = line.slice(0, at).split(':')
    const [host, port] = line.slice(at + 1).split(':')
    return build(defaultType, host, Number(port), user, pw.join(':'))
  }

  const parts = line.split(/\s+/).length > 1 ? line.split(/\s+/) : line.split(':')
  const [host, port, user, ...pw] = parts
  return build(defaultType, host ?? '', Number(port), user, pw.join(':'))
}

export function parseProxyLines(
  text: string,
  defaultType: ProxyType
): { items: NewProxy[]; badLines: number[] } {
  const items: NewProxy[] = []
  const badLines: number[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('//')) return
    const p = parseProxyLine(line, defaultType)
    if (p) items.push(p)
    else badLines.push(i + 1)
  })
  return { items, badLines }
}

/**
 * 生成代理 URL。mask 时密码替换为 ***(展示用);remoteDns 时 SOCKS5 写成 socks5h,
 * 让 DNS 也交给代理解析(服务器本地 DNS 被污染时 socks5:// 照样会失败)。
 */
export function proxyUrl(
  p: ProxyEntry,
  opts: { mask?: boolean; remoteDns?: boolean } = {}
): string {
  const host = p.host.includes(':') ? `[${p.host}]` : p.host
  let auth = ''
  if (p.username || p.password) {
    const pw = p.password ? `:${opts.mask ? '***' : encodeURIComponent(p.password)}` : ''
    auth = `${encodeURIComponent(p.username ?? '')}${pw}@`
  }
  const scheme = p.type === 'socks5' && opts.remoteDns ? 'socks5h' : p.type
  return `${scheme}://${auth}${host}:${p.port}`
}

/** 把输出里出现的代理密码(原文与 URL 编码形式)替换为 ***,再交给模型。 */
export function maskSecret(text: string, p?: ProxyEntry): string {
  if (!p?.password) return text
  let out = text
  for (const s of new Set([p.password, encodeURIComponent(p.password)])) {
    if (s.length >= 3) out = out.split(s).join('***')
  }
  return out
}

/** 国旗 emoji;Windows 不渲染国旗(只会显示两个字母),那里返回空串,由调用方改用国家代码。 */
export function flagEmoji(cc?: string): string {
  if (!cc || !/^[a-z]{2}$/i.test(cc)) return ''
  if (window.electron?.process.platform === 'win32') return ''
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

let regionNames: Intl.DisplayNames | null = null
function countryName(r: ProxyCheckResult): string | undefined {
  if (r.country) return r.country
  if (!r.countryCode) return undefined
  try {
    regionNames ??= new Intl.DisplayNames(['zh-CN'], { type: 'region' })
    return regionNames.of(r.countryCode.toUpperCase())
  } catch {
    return r.countryCode
  }
}

/** 「国家 · 省 · 城市」,相邻重复的去掉。 */
export function regionText(r?: ProxyCheckResult): string {
  if (!r?.ok) return ''
  const parts: string[] = []
  for (const x of [countryName(r), r.region, r.city]) {
    if (x && !parts.includes(x)) parts.push(x)
  }
  return parts.join(' · ')
}

export function latencyTone(ms?: number): 'good' | 'mid' | 'bad' {
  if (ms === undefined) return 'bad'
  return ms < 300 ? 'good' : ms < 800 ? 'mid' : 'bad'
}

/** 智能体给的站点(github.com / https://github.com/xx)→ 用于探测的 URL。 */
export function normalizeSite(site?: string): string | undefined {
  const s = site?.trim()
  if (!s) return undefined
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return `${u.protocol}//${u.host}/`
  } catch {
    return undefined
  }
}

/** 智能体目标 → 检测位置 key。本机 → 'local';SSH / 容器 → 宿主机 hostId。 */
export function targetKeyOf(t: AgentTarget): string | null {
  if (isLocalTarget(t)) return PROXY_LOCAL_KEY
  return t.hostId ?? null
}

// ---- 检测状态 + 智能体策略(页面与智能体共用) ---------------------------------

interface ProxyUiState {
  /** 正在检测的 `${proxyId}|${key}`。 */
  checking: Record<string, true>
  agentMode: AgentProxyMode
  hydrated: boolean
  hydrate: () => Promise<void>
  setAgentMode: (mode: AgentProxyMode) => Promise<void>
}

export const useProxyUiStore = create<ProxyUiState>((set, get) => ({
  checking: {},
  agentMode: 'ask',
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    const s = await window.api.settings.get()
    set({ agentMode: s.agentProxyMode, hydrated: true })
  },
  setAgentMode: async (mode) => {
    set({ agentMode: mode })
    const s = await window.api.settings.set({ agentProxyMode: mode })
    set({ agentMode: s.agentProxyMode })
  }
}))

const checkKey = (id: string, key: string): string => `${id}|${key}`

export async function checkProxy(
  id: string,
  key: string,
  probeUrl?: string
): Promise<ProxyCheckResult> {
  const ck = checkKey(id, key)
  useProxyUiStore.setState((s) => ({ checking: { ...s.checking, [ck]: true } }))
  try {
    const result = await window.api.proxy.check(id, key, probeUrl)
    useVaultStore.getState().applyProxyCheck(id, key, result)
    return result
  } catch (e) {
    return { ok: false, checkedAt: Date.now(), error: e instanceof Error ? e.message : String(e) }
  } finally {
    useProxyUiStore.setState((s) => {
      const next = { ...s.checking }
      delete next[ck]
      return { checking: next }
    })
  }
}

/** 并发检测一批代理。 */
export async function checkProxies(
  ids: string[],
  key: string,
  opts: { concurrency?: number; probeUrl?: string } = {}
): Promise<Map<string, ProxyCheckResult>> {
  const out = new Map<string, ProxyCheckResult>()
  const queue = [...ids]
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      out.set(id, await checkProxy(id, key, opts.probeUrl))
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, ids.length) }, worker))
  return out
}

// ---- 智能体:为某个检测位置挑一个最合适的代理 ---------------------------------

const FRESH_MS = 10 * 60 * 1000

export interface RankedProxy {
  proxy: ProxyEntry
  result: ProxyCheckResult
}

const fresh = (r?: ProxyCheckResult): r is ProxyCheckResult =>
  Boolean(r?.ok && Date.now() - r.checkedAt < FRESH_MS)

/** 站点探测通过的排前面,其余按延迟。 */
function rank(list: RankedProxy[], probeUrl?: string): RankedProxy[] {
  const probeOk = (r: ProxyCheckResult): number =>
    probeUrl && r.probe?.url === probeUrl ? (r.probe.ok ? 0 : 2) : 1
  return list
    .filter((x) => x.result.ok)
    .sort(
      (a, b) =>
        probeOk(a.result) - probeOk(b.result) ||
        (a.result.probe?.ms ?? a.result.latencyMs ?? 1e9) -
          (b.result.probe?.ms ?? b.result.latencyMs ?? 1e9)
    )
}

/**
 * 在检测位置 key 上挑代理:先用 10 分钟内的检测结果(带站点时对前三名补测站点),
 * 都不行再把所有代理现测一遍。返回按优先级排好的可用列表(可能为空)。
 */
export async function rankProxiesFor(key: string, probeUrl?: string): Promise<RankedProxy[]> {
  const all = (): ProxyEntry[] => useVaultStore.getState().proxies
  const current = (): RankedProxy[] =>
    all()
      .map((p) => ({ proxy: p, result: p.checks?.[key] }))
      .filter((x): x is RankedProxy => fresh(x.result))

  let cached = rank(current(), probeUrl)
  if (cached.length && probeUrl) {
    const top = cached.slice(0, 3).filter((x) => x.result.probe?.url !== probeUrl)
    if (top.length)
      await checkProxies(
        top.map((x) => x.proxy.id),
        key,
        { probeUrl }
      )
    cached = rank(current(), probeUrl)
  }
  const good = (x: RankedProxy): boolean =>
    !probeUrl || x.result.probe?.url !== probeUrl || x.result.probe.ok
  if (cached.some(good)) return cached

  const untested = all()
    .filter((p) => !(probeUrl && p.checks?.[key]?.probe?.url === probeUrl && fresh(p.checks[key])))
    .map((p) => p.id)
  if (untested.length) await checkProxies(untested, key, { probeUrl })
  return rank(current(), probeUrl)
}

/** 给模型看的代理描述:不含账号密码。 */
export function describeProxyForModel(x: RankedProxy): string {
  const r = x.result
  const region = regionText(r) || '未知地区'
  const lat = r.latencyMs !== undefined ? `${r.latencyMs}ms` : '未知'
  const probe = r.probe
    ? r.probe.ok
      ? `,经它访问 ${r.probe.url} 成功(HTTP ${r.probe.status},${r.probe.ms}ms)`
      : `,经它访问 ${r.probe.url} 失败(${r.probe.error ?? `HTTP ${r.probe.status}`})`
    : ''
  return `「${x.proxy.name}」(${PROXY_TYPE_LABEL[x.proxy.type]},出口 ${r.exitIp ?? '?'},${region},延迟 ${lat}${probe})`
}
