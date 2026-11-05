import type { ProxyEntry } from './types'

/**
 * 生成代理 URL。mask 时密码替换为 ***(展示用);remoteDns 时 SOCKS5 写成 socks5h,
 * 让 DNS 也交给代理解析(服务器本地 DNS 被污染时 socks5:// 照样会失败)。
 * 渲染层智能体的 {{proxy}} 与 MCP 的 proxy 参数共用。
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
