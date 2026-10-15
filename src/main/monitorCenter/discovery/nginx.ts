// 解析 `nginx -T` 输出,提取 server/location → proxy_pass/grpc_pass/fastcgi_pass/uwsgi_pass 的转发目标。
// nginx -T 把各个被 include 的文件依次打印出来(不内联),因此 server/upstream 块在任何层级都要找。

interface Directive {
  name: string
  args: string[]
  block?: Directive[]
}

export interface NginxRoute {
  listen: string[]
  serverName: string
  location: string
  directive: string
  target: string
  host: string
  port: number
}

function tokenize(text: string): string[] {
  const tokens: string[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '#') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '{' || c === '}' || c === ';') {
      tokens.push(c)
      i++
    } else if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < n && text[j] !== c) {
        if (text[j] === '\\' && j + 1 < n) j++
        s += text[j]
        j++
      }
      tokens.push(s)
      i = j + 1
    } else if (/\s/.test(c)) {
      i++
    } else {
      let j = i
      while (j < n && !/[\s{};]/.test(text[j])) j++
      // 以 # 开头才是注释;词中间的 # 是普通字符
      tokens.push(text.slice(i, j))
      i = j
    }
  }
  return tokens
}

function parse(tokens: string[]): Directive[] {
  let pos = 0
  const block = (): Directive[] => {
    const out: Directive[] = []
    while (pos < tokens.length) {
      const t = tokens[pos]
      if (t === '}') {
        pos++
        return out
      }
      if (t === ';' || t === '{') {
        pos++
        continue
      }
      const d: Directive = { name: t, args: [] }
      pos++
      while (
        pos < tokens.length &&
        tokens[pos] !== ';' &&
        tokens[pos] !== '{' &&
        tokens[pos] !== '}'
      ) {
        d.args.push(tokens[pos++])
      }
      if (tokens[pos] === '{') {
        pos++
        d.block = block()
      } else if (tokens[pos] === ';') pos++
      out.push(d)
    }
    return out
  }
  return block()
}

function walk(ds: Directive[], fn: (d: Directive) => boolean | void): void {
  for (const d of ds) {
    // fn 返回 true 表示不再深入
    if (fn(d) === true) continue
    if (d.block) walk(d.block, fn)
  }
}

const PASS = ['proxy_pass', 'grpc_pass', 'fastcgi_pass', 'uwsgi_pass', 'scgi_pass']

function splitHostPort(hp: string, defPort: number): { host: string; port: number } | null {
  if (!hp || hp.startsWith('unix:') || hp.includes('$')) return null
  const v6 = hp.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (v6) return { host: v6[1], port: Number(v6[2] || defPort) }
  const m = hp.match(/^([^:/]+)(?::(\d+))?$/)
  if (!m) return null
  return { host: m[1], port: Number(m[2] || defPort) }
}

function parseTarget(
  directive: string,
  value: string
): { hostPort: string; defPort: number } | null {
  const url = value.match(/^(\w+):\/\/([^/?]+)/)
  if (url) {
    const scheme = url[1].toLowerCase()
    const defPort = scheme === 'https' || scheme === 'grpcs' ? 443 : 80
    return { hostPort: url[2], defPort }
  }
  // fastcgi_pass / uwsgi_pass / grpc_pass 可以直接写 host:port
  if (directive !== 'proxy_pass') {
    return { hostPort: value, defPort: directive === 'fastcgi_pass' ? 9000 : 80 }
  }
  return null
}

export function parseNginx(text: string): NginxRoute[] {
  let tree: Directive[]
  try {
    tree = parse(tokenize(text))
  } catch {
    return []
  }
  const upstreams = new Map<string, { host: string; port: number }[]>()
  walk(tree, (d) => {
    if (d.name === 'upstream' && d.args[0] && d.block) {
      const servers = d.block
        .filter((x) => x.name === 'server' && x.args[0])
        .map((x) => splitHostPort(x.args[0], 80))
        .filter((x): x is { host: string; port: number } => !!x)
      upstreams.set(d.args[0], servers)
      return true
    }
    return undefined
  })

  const routes: NginxRoute[] = []
  walk(tree, (d) => {
    if (d.name !== 'server' || !d.block) return undefined
    const listen = d.block.filter((x) => x.name === 'listen').map((x) => x.args[0])
    const serverName =
      d.block
        .find((x) => x.name === 'server_name')
        ?.args.filter((x) => x !== '_')
        .join(' ') || ''
    const visit = (ds: Directive[], location: string): void => {
      for (const x of ds) {
        if (x.name === 'location' && x.block) {
          visit(x.block, x.args.join(' '))
        } else if (PASS.includes(x.name) && x.args[0]) {
          const t = parseTarget(x.name, x.args[0])
          if (!t) continue
          const name = t.hostPort.replace(/:\d+$/, '')
          const ups = upstreams.get(t.hostPort) || upstreams.get(name)
          const targets = ups ?? [splitHostPort(t.hostPort, t.defPort)].filter(Boolean)
          for (const target of targets as { host: string; port: number }[]) {
            routes.push({
              listen,
              serverName,
              location,
              directive: x.name,
              target: x.args[0],
              host: target.host,
              port: target.port
            })
          }
        }
      }
    }
    visit(d.block, '/')
    return true
  })
  return routes
}

/** nginx 自身监听的端口(用于补全没有 ss -p 权限时的服务端口)。 */
export function nginxListenPorts(text: string): number[] {
  const ports = new Set<number>()
  for (const m of text.matchAll(/^\s*listen\s+([^;]+);/gm)) {
    const p = m[1].trim().split(/\s+/)[0]
    const port = Number(p.match(/(\d+)$/)?.[1])
    if (port > 0 && port < 65536) ports.add(port)
  }
  return [...ports]
}
