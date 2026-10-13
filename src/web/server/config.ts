import { resolve, join } from 'path'
import { homedir } from 'os'

// Web edition runtime configuration: command-line flags win over NEBUSHELL_* env vars,
// which win over the defaults. Parsed once at import time because the Electron shim
// needs the data directory before any manager singleton (vault, settings) is constructed.

export interface WebConfig {
  host: string
  port: number
  dataDir: string
  /** Directory holding the built browser bundle (index.html + assets). */
  staticDir: string
  /** Honour X-Forwarded-* headers (client IP, https) from a reverse proxy. */
  trustProxy: boolean
  /** Expose the server's own filesystem and shell ("local" pane, agent local:exec). */
  local: boolean
}

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === `--${name}`) {
      const next = argv[i + 1]
      return next === undefined || next.startsWith('--') ? 'true' : next
    }
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3)
  }
  return undefined
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback
  return !['0', 'false', 'no', 'off'].includes(v.toLowerCase())
}

function parse(): WebConfig {
  const env = process.env
  const port = Number(flag('port') ?? env.NEBUSHELL_PORT ?? 8080)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${port}`)
  }
  return {
    host: flag('host') ?? env.NEBUSHELL_HOST ?? '127.0.0.1',
    port,
    dataDir: resolve(
      flag('data-dir') ?? env.NEBUSHELL_DATA_DIR ?? join(homedir(), '.nebushell-web')
    ),
    staticDir: resolve(
      flag('static-dir') ?? env.NEBUSHELL_STATIC_DIR ?? join(__dirname, '../client')
    ),
    trustProxy: bool(flag('trust-proxy') ?? env.NEBUSHELL_TRUST_PROXY, false),
    local: !bool(flag('no-local') ?? env.NEBUSHELL_NO_LOCAL, false)
  }
}

export const HELP = `Usage: nebushell-web [options]

  --host <addr>        Listen address (default 127.0.0.1, env NEBUSHELL_HOST)
  --port <n>           Listen port (default 8080, env NEBUSHELL_PORT)
  --data-dir <dir>     Vault, settings and history (default ~/.nebushell-web, env NEBUSHELL_DATA_DIR)
  --static-dir <dir>   Built browser bundle (default ../client next to the server)
  --trust-proxy        Trust X-Forwarded-For / -Proto / -Host from a reverse proxy
  --no-local           Disable the server-local file pane and local command execution
  --help               Show this help
`

export const config: WebConfig = parse()
