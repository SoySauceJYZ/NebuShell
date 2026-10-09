import { Socket } from 'net'
import { connect as tlsConnect, TLSSocket } from 'tls'
import type { Host, ProxyCheckResult, ProxyEntry } from '../../shared/types'
import { mcpSshPool } from '../mcp/McpSshPool'

/** 单次请求(连代理 + 握手 + HTTP 往返)的上限。 */
const STEP_TIMEOUT_MS = 10000
const MAX_BODY = 256 * 1024

/**
 * 出口 IP / 地区查询源,按顺序回退。前两个走 443 —— 不少 HTTP 代理只放行到 443 的
 * CONNECT;ip-api 免费版只有明文 HTTP,放最后兜底。
 */
const GEO_SOURCES = [
  'https://ipwho.is/?lang=zh-CN',
  'https://ipinfo.io/json',
  'http://ip-api.com/json/?lang=zh-CN'
]

type Geo = Pick<ProxyCheckResult, 'exitIp' | 'country' | 'countryCode' | 'region' | 'city' | 'isp'>

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

/** 把各家查询源的 JSON 归一化;查询源自己报失败时返回 null。 */
function parseGeo(source: string, body: string): Geo | null {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(body)
  } catch {
    return null
  }
  if (source.includes('ipwho.is')) {
    if (j.success === false) return null
    const conn = (j.connection ?? {}) as Record<string, unknown>
    return {
      exitIp: str(j.ip),
      country: str(j.country),
      countryCode: str(j.country_code),
      region: str(j.region),
      city: str(j.city),
      isp: str(conn.isp) ?? str(conn.org)
    }
  }
  if (source.includes('ipinfo.io')) {
    if (!str(j.ip)) return null
    return {
      exitIp: str(j.ip),
      countryCode: str(j.country),
      region: str(j.region),
      city: str(j.city),
      // org 形如 "AS13335 Cloudflare, Inc.",去掉 AS 号。
      isp: str(j.org)?.replace(/^AS\d+\s+/, '')
    }
  }
  if (j.status !== 'success') return null
  return {
    exitIp: str(j.query),
    country: str(j.country),
    countryCode: str(j.countryCode),
    region: str(j.regionName),
    city: str(j.city),
    isp: str(j.isp)
  }
}

function errMsg(e: unknown): string {
  const err = e as NodeJS.ErrnoException
  switch (err?.code) {
    case 'ECONNREFUSED':
      return '代理拒绝连接(端口未开放)'
    case 'ETIMEDOUT':
      return '连接代理超时'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return '无法解析代理地址'
    case 'ECONNRESET':
      return '连接被重置'
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return '网络不可达'
  }
  return err?.message ?? String(e)
}

// ---- 本机检测:手写 HTTP CONNECT / SOCKS5 隧道,零依赖 -----------------------

/** 按需读取 socket 数据的小工具;握手结束后 release() 把控制权还给下一层(TLS)。 */
class Reader {
  private buf = Buffer.alloc(0)
  private waiters: (() => void)[] = []
  private err: Error | null = null
  private closed = false
  private onData = (d: Buffer): void => {
    this.buf = Buffer.concat([this.buf, d])
    this.wake()
  }
  private onError = (e: Error): void => {
    this.err = e
    this.wake()
  }
  private onClose = (): void => {
    this.closed = true
    this.wake()
  }

  constructor(private sock: Socket) {
    sock.on('data', this.onData)
    sock.on('error', this.onError)
    sock.on('close', this.onClose)
  }

  private wake(): void {
    const w = this.waiters
    this.waiters = []
    w.forEach((f) => f())
  }

  private async more(): Promise<void> {
    if (this.err) throw this.err
    if (this.closed) throw new Error('代理关闭了连接')
    await new Promise<void>((r) => this.waiters.push(r))
  }

  async read(n: number): Promise<Buffer> {
    while (this.buf.length < n) await this.more()
    const out = this.buf.subarray(0, n)
    this.buf = this.buf.subarray(n)
    return out
  }

  async readUntil(delim: string, max = 16384): Promise<Buffer> {
    for (;;) {
      const i = this.buf.indexOf(delim)
      if (i !== -1) {
        const out = this.buf.subarray(0, i + delim.length)
        this.buf = this.buf.subarray(i + delim.length)
        return out
      }
      if (this.buf.length > max) throw new Error('代理响应过长')
      await this.more()
    }
  }

  release(): void {
    this.sock.removeListener('data', this.onData)
    this.sock.removeListener('error', this.onError)
    this.sock.removeListener('close', this.onClose)
    this.sock.pause()
    if (this.buf.length) this.sock.unshift(this.buf)
  }
}

function connectTcp(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = new Socket()
    s.setNoDelay(true)
    const timer = setTimeout(() => {
      s.destroy()
      reject(Object.assign(new Error('连接代理超时'), { code: 'ETIMEDOUT' }))
    }, STEP_TIMEOUT_MS)
    s.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    s.connect(port, host, () => {
      clearTimeout(timer)
      s.removeAllListeners('error')
      resolve(s)
    })
  })
}

function wrapTls(socket: Socket, servername: string, verify = true): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const isIp = /^[\d.]+$/.test(servername) || servername.includes(':')
    const t = tlsConnect(
      {
        socket,
        servername: isIp ? undefined : servername,
        rejectUnauthorized: verify,
        ALPNProtocols: ['http/1.1']
      },
      () => {
        t.removeListener('error', reject)
        resolve(t)
      }
    )
    t.once('error', reject)
  })
}

async function httpConnect(sock: Socket, p: ProxyEntry, host: string, port: number): Promise<void> {
  const r = new Reader(sock)
  const auth =
    p.username || p.password
      ? `Proxy-Authorization: Basic ${Buffer.from(`${p.username ?? ''}:${p.password ?? ''}`).toString('base64')}\r\n`
      : ''
  sock.write(
    `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}User-Agent: NebuShell\r\n\r\n`
  )
  const head = (await r.readUntil('\r\n\r\n')).toString('latin1')
  r.release()
  const statusLine = head.split('\r\n')[0]
  const code = Number(statusLine.split(' ')[1])
  if (code === 407) throw new Error('代理认证失败(407),请检查用户名/密码')
  if (!(code >= 200 && code < 300)) throw new Error(`代理拒绝建立隧道:${statusLine}`)
}

const SOCKS_REPLY: Record<number, string> = {
  1: 'SOCKS 服务器故障',
  2: '规则禁止该连接',
  3: '网络不可达',
  4: '目标主机不可达',
  5: '目标拒绝连接',
  6: 'TTL 过期',
  7: '不支持的命令',
  8: '不支持的地址类型'
}

async function socks5Connect(
  sock: Socket,
  p: ProxyEntry,
  host: string,
  port: number
): Promise<void> {
  const r = new Reader(sock)
  const hasAuth = Boolean(p.username || p.password)
  sock.write(Buffer.from(hasAuth ? [5, 2, 0, 2] : [5, 1, 0]))
  const [ver, method] = await r.read(2)
  if (ver !== 5) throw new Error('不是 SOCKS5 代理(握手响应异常)')
  if (method === 0xff) throw new Error('SOCKS5 代理不接受所给的认证方式')
  if (method === 2) {
    const u = Buffer.from(p.username ?? '')
    const pw = Buffer.from(p.password ?? '')
    sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([pw.length]), pw]))
    const [, status] = await r.read(2)
    if (status !== 0) throw new Error('SOCKS5 认证失败,请检查用户名/密码')
  }
  const h = Buffer.from(host)
  sock.write(
    Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 0xff])])
  )
  const [, rep, , atyp] = await r.read(4)
  if (rep !== 0) throw new Error(`SOCKS5 连接失败:${SOCKS_REPLY[rep] ?? `错误码 ${rep}`}`)
  if (atyp === 1) await r.read(6)
  else if (atyp === 4) await r.read(18)
  else if (atyp === 3) await r.read((await r.read(1))[0] + 2)
  r.release()
}

/** 建立经代理到 host:port 的隧道。返回隧道 socket 以及 TCP 连上代理的耗时。 */
async function openTunnel(
  p: ProxyEntry,
  host: string,
  port: number
): Promise<{ sock: Socket; connectMs: number }> {
  const t0 = Date.now()
  let sock: Socket = await connectTcp(p.host, p.port)
  const connectMs = Date.now() - t0
  try {
    if (p.type === 'https') sock = await wrapTls(sock, p.host)
    if (p.type === 'socks5') await socks5Connect(sock, p, host, port)
    else await httpConnect(sock, p, host, port)
    return { sock, connectMs }
  } catch (e) {
    sock.destroy()
    throw e
  }
}

/** 在已建立的流上发一次 HTTP/1.0 请求(1.0 避开 chunked)。HEAD 拿到响应头即返回。 */
function httpOver(
  stream: Socket,
  method: 'GET' | 'HEAD',
  host: string,
  path: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    const finish = (): void => {
      const text = buf.toString('utf8')
      const sep = text.indexOf('\r\n\r\n')
      const status = Number(text.split('\r\n')[0]?.split(' ')[1])
      if (!status) {
        reject(new Error('响应格式异常'))
        return
      }
      resolve({ status, body: sep === -1 ? '' : text.slice(sep + 4) })
    }
    stream.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      if (buf.length > MAX_BODY || (method === 'HEAD' && buf.includes('\r\n\r\n'))) {
        stream.destroy()
        finish()
      }
    })
    stream.once('end', finish)
    stream.once('error', reject)
    stream.resume()
    stream.write(
      `${method} ${path} HTTP/1.0\r\nHost: ${host}\r\nUser-Agent: curl/8.0 (NebuShell)\r\n` +
        'Accept: application/json, */*\r\nConnection: close\r\n\r\n'
    )
  })
}

/** 经代理请求一个 URL,整体受 STEP_TIMEOUT_MS 约束。 */
async function fetchVia(
  p: ProxyEntry,
  url: string,
  method: 'GET' | 'HEAD'
): Promise<{ status: number; body: string; connectMs: number; totalMs: number }> {
  const u = new URL(url)
  const https = u.protocol === 'https:'
  const port = Number(u.port) || (https ? 443 : 80)
  const t0 = Date.now()
  let live: Socket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const work = (async () => {
    const { sock, connectMs } = await openTunnel(p, u.hostname, port)
    live = sock
    const stream = https ? await wrapTls(sock, u.hostname) : sock
    live = stream
    const res = await httpOver(stream, method, u.host, u.pathname + u.search)
    stream.destroy()
    return { ...res, connectMs, totalMs: Date.now() - t0 }
  })()
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ;(live as Socket | null)?.destroy()
      reject(new Error('请求超时'))
    }, STEP_TIMEOUT_MS)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    work.catch(() => undefined)
  }
}

async function probeLocal(p: ProxyEntry, url: string): Promise<ProxyCheckResult['probe']> {
  try {
    const r = await fetchVia(p, url, 'HEAD')
    return { url, ok: r.status >= 200 && r.status < 500, status: r.status, ms: r.totalMs }
  } catch (e) {
    return { url, ok: false, error: errMsg(e) }
  }
}

export async function checkLocal(p: ProxyEntry, probeUrl?: string): Promise<ProxyCheckResult> {
  let lastErr = ''
  for (const src of GEO_SOURCES) {
    try {
      const r = await fetchVia(p, src, 'GET')
      const geo = r.status === 200 ? parseGeo(src, r.body) : null
      if (!geo) {
        lastErr = `查询源 ${new URL(src).host} 返回 HTTP ${r.status}`
        continue
      }
      return {
        ok: true,
        checkedAt: Date.now(),
        connectMs: r.connectMs,
        latencyMs: r.totalMs,
        ...geo,
        ...(probeUrl ? { probe: await probeLocal(p, probeUrl) } : {})
      }
    } catch (e) {
      lastErr = errMsg(e)
      // 代理本身连不上/认证失败,换查询源也没用,直接结束。
      if (/代理|SOCKS|认证|ECONNREFUSED|解析/.test(lastErr)) break
    }
  }
  return { ok: false, checkedAt: Date.now(), error: lastErr || '检测失败' }
}

// ---- 远端检测:在选中主机上经 curl 走代理 ------------------------------------

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
const curlQuote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** 取 curl 的报错行(去掉 "curl: (7) " 前缀)。 */
function curlError(text: string): string {
  const line = text.split('\n').find((l) => l.startsWith('curl:'))
  return line ? line.replace(/^curl: \(\d+\)\s*/, '').trim() : ''
}

function curlScheme(p: ProxyEntry): string {
  // socks5h:DNS 也交给代理解析,避免目标主机本地 DNS 被污染时误判。
  return p.type === 'socks5' ? 'socks5h' : p.type
}

export async function checkRemote(
  host: Host,
  p: ProxyEntry,
  probeUrl?: string
): Promise<ProxyCheckResult> {
  // 代理地址与凭据经 stdin 写入临时 curl 配置文件,不出现在远端命令行/进程列表里。
  const hostPart = p.host.includes(':') ? `[${p.host}]` : p.host
  const config =
    `proxy = ${curlQuote(`${curlScheme(p)}://${hostPart}:${p.port}`)}\n` +
    (p.username || p.password
      ? `proxy-user = ${curlQuote(`${p.username ?? ''}:${p.password ?? ''}`)}\n`
      : '')
  const t = Math.round(STEP_TIMEOUT_MS / 1000)
  const script = [
    'command -v curl >/dev/null 2>&1 || exit 127',
    'umask 077',
    'c=$(mktemp 2>/dev/null) || c=/tmp/.nebushell-proxy-$$',
    `trap 'rm -f "$c"' EXIT`,
    'cat > "$c"',
    'ok=0',
    `for u in ${GEO_SOURCES.map(shQuote).join(' ')}; do`,
    '  echo "__NEBU_GEO__"',
    `  curl -sS -f -K "$c" -m ${t} -H 'Accept: application/json' -A 'curl/8.0 (NebuShell)' ` +
      `-w '\\n__NEBU_W__ %{http_code} %{time_connect} %{time_total}\\n' "$u" 2>&1 && { ok=1; break; }`,
    // 5/7/97:代理解析失败 / 连不上代理 / SOCKS 握手失败 —— 换查询源也没用。
    '  case $? in 5|7|97) break;; esac',
    'done',
    ...(probeUrl
      ? [
          '[ "$ok" = 1 ] || exit 0',
          'echo "__NEBU_PROBE__"',
          `curl -sS -K "$c" -m ${t} -o /dev/null -I -w '\\n%{http_code} %{time_total}\\n' ${shQuote(probeUrl)} 2>&1`
        ]
      : [])
  ].join('\n')

  const res = await mcpSshPool.exec(host, `sh -c ${shQuote(script)}`, {
    timeoutMs: STEP_TIMEOUT_MS * (GEO_SOURCES.length + 1) + 5000,
    maxBytes: MAX_BODY,
    stdin: config
  })
  if (res.code === 127) {
    return { ok: false, checkedAt: Date.now(), error: `目标主机「${host.label}」未安装 curl` }
  }
  if (res.timedOut) return { ok: false, checkedAt: Date.now(), error: '远端检测超时' }

  const [geoPart, probePart] = res.stdout.split('__NEBU_PROBE__')
  const sections = geoPart.split('__NEBU_GEO__').slice(1)
  let result: ProxyCheckResult | null = null
  let lastErr = ''
  sections.forEach((sec, i) => {
    if (result) return
    const m = sec.match(/__NEBU_W__ (\d+) ([\d.]+) ([\d.]+)/)
    if (!m || m[1] !== '200') {
      lastErr = curlError(sec) || (m ? `查询源返回 HTTP ${m[1]}` : '请求失败')
      if (/\b407\b/.test(lastErr)) lastErr = '代理认证失败(407),请检查用户名/密码'
      else if (/rejected by the SOCKS5|SOCKS5.*auth/i.test(lastErr))
        lastErr = 'SOCKS5 认证失败,请检查用户名/密码'
      return
    }
    // curl 的报错行(若有)经 2>&1 混在输出里,解析 JSON 前剔除。
    const body = sec
      .slice(0, m.index)
      .split('\n')
      .filter((l) => !l.startsWith('curl:'))
      .join('\n')
    const geo = parseGeo(GEO_SOURCES[i], body.trim())
    if (!geo) {
      lastErr = '查询源返回异常'
      return
    }
    result = {
      ok: true,
      checkedAt: Date.now(),
      connectMs: Math.round(Number(m[2]) * 1000),
      latencyMs: Math.round(Number(m[3]) * 1000),
      ...geo
    }
  })
  if (!result) {
    return {
      ok: false,
      checkedAt: Date.now(),
      error: lastErr || res.stderr.trim() || '检测失败'
    }
  }
  if (probeUrl && probePart !== undefined) {
    const pm = probePart.match(/^(\d{3}) ([\d.]+)$/m)
    const status = pm ? Number(pm[1]) : 0
    ;(result as ProxyCheckResult).probe =
      status > 0
        ? {
            url: probeUrl,
            ok: status >= 200 && status < 500,
            status,
            ms: Math.round(Number(pm![2]) * 1000)
          }
        : {
            url: probeUrl,
            ok: false,
            error: curlError(probePart) || '无法访问'
          }
  }
  return result
}
