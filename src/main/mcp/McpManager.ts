import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { networkInterfaces } from 'os'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpStatus } from '../../shared/types'
import { settingsManager } from '../settings/SettingsManager'
import { createMcpServer } from './tools'
import { mcpSshPool } from './McpSshPool'
import { auditLog } from './audit'

const MAX_BODY = 4 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : undefined)
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** 内置 MCP 服务:Streamable HTTP(无状态),Bearer 令牌鉴权。 */
export class McpManager {
  private server: Server | null = null
  private port: number | null = null
  private lastError: string | undefined

  generateToken(): string {
    return randomBytes(32).toString('hex')
  }

  private authorized(req: IncomingMessage): boolean {
    const token = settingsManager.get().mcpToken
    if (!token) return false
    const header = req.headers.authorization ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    const a = Buffer.from(given)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '').split('?')[0]
    if (url !== '/mcp') return json(res, 404, { error: 'not found' })
    if (!this.authorized(req)) {
      auditLog({ client: req.socket.remoteAddress, event: 'unauthorized' })
      res.setHeader('WWW-Authenticate', 'Bearer')
      return json(res, 401, { error: 'unauthorized' })
    }
    if (req.method !== 'POST') {
      // 无状态模式:不支持 GET(SSE 流)与 DELETE(会话终止)。
      res.setHeader('Allow', 'POST')
      return json(res, 405, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
      })
    }

    let body: unknown
    try {
      body = await readBody(req)
    } catch {
      return json(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null
      })
    }

    const mcp = createMcpServer(req.socket.remoteAddress ?? 'unknown')
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    try {
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (e) {
      json(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: e instanceof Error ? e.message : 'Internal error' },
        id: null
      })
    }
  }

  private listen(preferred: number): Promise<{ server: Server; port: number }> {
    const attempt = (port: number): Promise<{ server: Server; port: number }> =>
      new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
          this.handle(req, res).catch((e) =>
            json(res, 500, { error: e instanceof Error ? e.message : String(e) })
          )
        })
        server.once('error', reject)
        server.listen(port, '0.0.0.0', () => {
          server.removeAllListeners('error')
          const addr = server.address()
          resolve({ server, port: typeof addr === 'object' && addr ? addr.port : port })
        })
      })
    return attempt(preferred).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') return attempt(0)
      throw err
    })
  }

  async start(): Promise<McpStatus> {
    if (this.server) return this.status()
    const s = settingsManager.get()
    if (!s.mcpToken) settingsManager.update({ mcpToken: this.generateToken() })
    try {
      const { server, port } = await this.listen(s.mcpPort)
      this.server = server
      this.port = port
      this.lastError = undefined
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
    }
    return this.status()
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.port = null
    mcpSshPool.closeAll()
    if (server) {
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  status(): McpStatus {
    if (!this.server || this.port === null) {
      return { running: false, port: null, urls: [], error: this.lastError }
    }
    const urls = [`http://127.0.0.1:${this.port}/mcp`]
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${this.port}/mcp`)
      }
    }
    return { running: true, port: this.port, urls }
  }
}

export const mcpManager = new McpManager()
