import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createReadStream, createWriteStream, mkdirSync, statSync } from 'fs'
import { dirname, isAbsolute } from 'path'
import type { Readable } from 'stream'
import type { ClientChannel, SFTPWrapper, Stats } from 'ssh2'
import { z } from 'zod'
import type { Host } from '../../shared/types'
import { mcpSshPool, resolveHost } from './McpSshPool'
import { fail, inTarget, ok, sftpCall, shellQuote, wrap, type ToolExtra } from './toolkit'

/**
 * 二进制文件传输:上传 / 下载(本地路径或 base64 内联)与主机间直接中转。
 * 宿主机 + 本地路径走 SFTP fastPut/fastGet(并发分块,最快);
 * 容器或内联内容走 exec 通道的 cat / tar 流,与宿主机共用同一条 SSH 连接。
 */

/** 内联(base64)上传 / 下载的上限;请求体整体还受 4MB 限制。 */
const INLINE_MAX = 2 * 1024 * 1024
const DEFAULT_TRANSFER_TIMEOUT_S = 1800
const MAX_TRANSFER_TIMEOUT_S = 7200

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function rate(bytes: number, ms: number): string {
  return ms > 0 ? `${human(Math.round((bytes / ms) * 1000))}/s` : ''
}

interface ChannelEnd {
  code: number | null
  stderr: string
}

/** 收集通道的退出码与 stderr;通道关闭时 resolve。 */
function channelDone(ch: ClientChannel): Promise<ChannelEnd> {
  return new Promise((resolve, reject) => {
    let code: number | null = null
    let stderr = ''
    ch.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 4000) stderr += c.toString('utf8')
    })
    ch.on('exit', (c: number | null) => (code = c))
    ch.on('close', () => resolve({ code, stderr: stderr.trim() }))
    ch.on('error', reject)
  })
}

/**
 * 把可读流灌进通道的 stdin,读完自动发 EOF。
 * 不用 stream.pipeline:它在结束时可能先销毁通道,导致拿不到远端退出码。
 */
function feed(src: Readable, ch: ClientChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    src.on('error', reject)
    src.on('end', () => resolve())
    src.pipe(ch)
  })
}

/** 把通道的 stdout 写进本地文件,写完 resolve。 */
function drainTo(ch: ClientChannel, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(file)
    ws.on('finish', () => resolve())
    ws.on('error', (e) => {
      ch.close()
      reject(e)
    })
    ch.pipe(ws)
  })
}

/** 超时 / 客户端取消时关闭这些通道;返回清理函数。 */
function guard(
  channels: ClientChannel[],
  timeoutS: number,
  extra: ToolExtra,
  onAbort: (why: string) => void
): () => void {
  const kill = (why: string): void => {
    onAbort(why)
    for (const c of channels) {
      try {
        c.close()
      } catch {
        // 已关闭
      }
    }
  }
  const timer = setTimeout(() => kill(`超过 ${timeoutS} 秒未完成`), timeoutS * 1000)
  const onSignal = (): void => kill('客户端已取消')
  extra.signal.addEventListener('abort', onSignal)
  return () => {
    clearTimeout(timer)
    extra.signal.removeEventListener('abort', onSignal)
  }
}

/** 远端路径是目录 / 文件 / 不存在。 */
async function kindOf(
  host: Host,
  container: string | undefined,
  path: string
): Promise<'dir' | 'file' | 'none'> {
  const cmd = await inTarget(
    host,
    container,
    'if [ -d "$1" ]; then echo DIR; elif [ -e "$1" ]; then echo FILE; else echo NONE; fi',
    {
      args: [path]
    }
  )
  const r = await mcpSshPool.exec(host, cmd, { timeoutMs: 30_000, maxBytes: 1000 })
  const out = r.stdout.trim()
  if (out.endsWith('DIR')) return 'dir'
  if (out.endsWith('FILE')) return 'file'
  if (out.endsWith('NONE')) return 'none'
  throw new Error(r.stderr || `无法检查路径 ${path}`)
}

function checkLocalPath(p: string): void {
  if (!isAbsolute(p)) throw new Error(`local_path 必须是绝对路径: ${p}`)
}

const timeoutArg = z
  .number()
  .int()
  .min(10)
  .max(MAX_TRANSFER_TIMEOUT_S)
  .optional()
  .describe(`超时秒数,默认 ${DEFAULT_TRANSFER_TIMEOUT_S},最大 ${MAX_TRANSFER_TIMEOUT_S}`)

export function registerTransferTools(server: McpServer, clientIp: string): void {
  server.registerTool(
    'upload_file',
    {
      description:
        '把文件上传到服务器(或容器内),支持二进制。内容二选一:\n' +
        '- local_path:运行 NebuShell 的这台电脑上的绝对路径(MCP 客户端与 NebuShell 在同一台机器时用,无大小限制);\n' +
        `- content_base64:base64 编码的内容(最大 ${INLINE_MAX / 1024 / 1024}MB)。\n` +
        '默认自动创建父目录;mode 可设置权限(如 "755")。',
      inputSchema: {
        host: z.string(),
        remote_path: z.string().describe('目标文件的绝对路径'),
        local_path: z.string().optional(),
        content_base64: z.string().optional(),
        container: z.string().optional().describe('上传到该容器内'),
        mode: z
          .string()
          .regex(/^[0-7]{3,4}$/)
          .optional()
          .describe('八进制权限,例如 644 / 755'),
        timeout_seconds: timeoutArg
      }
    },
    wrap(
      'upload_file',
      clientIp,
      (a: { remote_path: string; local_path?: string; container?: string }) =>
        `${a.local_path ?? '(base64)'} → ${a.container ? `[${a.container}] ` : ''}${a.remote_path}`,
      async (
        a: {
          host: string
          remote_path: string
          local_path?: string
          content_base64?: string
          container?: string
          mode?: string
          timeout_seconds?: number
        },
        extra
      ) => {
        if (!!a.local_path === (a.content_base64 !== undefined)) {
          return fail('local_path 与 content_base64 必须且只能传一个')
        }
        const host = resolveHost(a.host)
        let size: number
        let inline: Buffer | undefined
        if (a.local_path) {
          checkLocalPath(a.local_path)
          const st = statSync(a.local_path)
          if (!st.isFile()) return fail(`${a.local_path} 不是文件`)
          size = st.size
        } else {
          inline = Buffer.from(a.content_base64!, 'base64')
          if (inline.length > INLINE_MAX) {
            return fail(
              `内联内容 ${human(inline.length)},超过 ${INLINE_MAX / 1024 / 1024}MB;请改用 local_path`
            )
          }
          size = inline.length
        }
        const started = Date.now()
        const timeoutS = a.timeout_seconds ?? DEFAULT_TRANSFER_TIMEOUT_S

        if (!a.container && a.local_path) {
          // 宿主机 + 本地文件:SFTP 并发分块上传。
          const mk = await mcpSshPool.exec(
            host,
            `mkdir -p ${shellQuote(dirnamePosix(a.remote_path))}`,
            {
              timeoutMs: 30_000,
              maxBytes: 4000
            }
          )
          if (mk.code !== 0) return fail(mk.stderr || '创建父目录失败')
          const sftp: SFTPWrapper = await mcpSshPool.sftp(host)
          await mcpSshPool.withHold(host, () =>
            withTimeout(
              sftpCall<void>((cb) =>
                sftp.fastPut(a.local_path!, a.remote_path, (e) => cb(e, undefined))
              ),
              timeoutS,
              extra
            )
          )
          if (a.mode)
            await sftpCall<void>((cb) =>
              sftp.chmod(a.remote_path, parseInt(a.mode!, 8), (e) => cb(e, undefined))
            )
        } else {
          const script =
            'mkdir -p "$(dirname "$1")" && cat > "$1"' + (a.mode ? ` && chmod ${a.mode} "$1"` : '')
          const cmd = await inTarget(host, a.container, script, {
            interactive: true,
            args: [a.remote_path]
          })
          const ch = await mcpSshPool.channel(host, cmd)
          const done = channelDone(ch)
          ch.resume() // 远端 stdout 为空,但不消费的话通道可能不触发 close
          let aborted = ''
          const release = guard([ch], timeoutS, extra, (w) => (aborted = w))
          try {
            if (inline) ch.end(inline)
            else await feed(createReadStream(a.local_path!), ch)
            const end = await done
            if (aborted) return fail(`上传中断:${aborted}`)
            if (end.code !== 0) return fail(end.stderr || `上传失败(退出码 ${end.code})`)
          } finally {
            release()
          }
        }
        const ms = Date.now() - started
        return ok(
          `已上传到 ${host.label}${a.container ? ` 容器 ${a.container}` : ''}:${a.remote_path}` +
            `(${human(size)},耗时 ${(ms / 1000).toFixed(1)}s ${rate(size, ms)})`
        )
      }
    )
  )

  server.registerTool(
    'download_file',
    {
      description:
        '从服务器(或容器内)下载文件,支持二进制。传 local_path 时保存到运行 NebuShell 的这台电脑' +
        `(自动创建目录,无大小限制);不传时以 base64 返回内容(最大 ${INLINE_MAX / 1024 / 1024}MB)。` +
        '下载目录请先在远端 tar 打包。',
      inputSchema: {
        host: z.string(),
        remote_path: z.string(),
        local_path: z.string().optional().describe('本机保存路径(绝对路径)'),
        container: z.string().optional(),
        timeout_seconds: timeoutArg
      }
    },
    wrap(
      'download_file',
      clientIp,
      (a: { remote_path: string; local_path?: string; container?: string }) =>
        `${a.container ? `[${a.container}] ` : ''}${a.remote_path} → ${a.local_path ?? '(base64)'}`,
      async (
        a: {
          host: string
          remote_path: string
          local_path?: string
          container?: string
          timeout_seconds?: number
        },
        extra
      ) => {
        const host = resolveHost(a.host)
        const timeoutS = a.timeout_seconds ?? DEFAULT_TRANSFER_TIMEOUT_S
        if (a.local_path) checkLocalPath(a.local_path)
        const started = Date.now()

        if (!a.container) {
          const sftp: SFTPWrapper = await mcpSshPool.sftp(host)
          const st = await sftpCall<Stats>((cb) => sftp.stat(a.remote_path, cb))
          if (st.isDirectory()) return fail(`${a.remote_path} 是目录;请先在远端 tar 打包再下载`)
          const size = st.size ?? 0
          if (a.local_path) {
            mkdirSync(dirname(a.local_path), { recursive: true })
            await mcpSshPool.withHold(host, () =>
              withTimeout(
                sftpCall<void>((cb) =>
                  sftp.fastGet(a.remote_path, a.local_path!, (e) => cb(e, undefined))
                ),
                timeoutS,
                extra
              )
            )
            const ms = Date.now() - started
            return ok(
              `已下载到 ${a.local_path}(${human(size)},耗时 ${(ms / 1000).toFixed(1)}s ${rate(size, ms)})`
            )
          }
          if (size > INLINE_MAX) {
            return fail(
              `文件 ${human(size)},超过内联上限 ${INLINE_MAX / 1024 / 1024}MB;请传 local_path`
            )
          }
          const buf = await sftpCall<Buffer>((cb) => sftp.readFile(a.remote_path, cb))
          return ok(inlineResult(a.remote_path, buf))
        }

        // 容器内:cat 流出。
        const kind = await kindOf(host, a.container, a.remote_path)
        if (kind === 'none') return fail(`容器内不存在 ${a.remote_path}`)
        if (kind === 'dir') return fail(`${a.remote_path} 是目录;请先在容器内 tar 打包再下载`)
        const cmd = await inTarget(host, a.container, 'cat -- "$1"', { args: [a.remote_path] })
        const ch = await mcpSshPool.channel(host, cmd)
        const done = channelDone(ch)
        let aborted = ''
        const release = guard([ch], timeoutS, extra, (w) => (aborted = w))
        try {
          if (a.local_path) {
            mkdirSync(dirname(a.local_path), { recursive: true })
            const [end] = await Promise.all([done, drainTo(ch, a.local_path)])
            if (aborted) return fail(`下载中断:${aborted}`)
            if (end.code !== 0) return fail(end.stderr || `下载失败(退出码 ${end.code})`)
            const size = statSync(a.local_path).size
            const ms = Date.now() - started
            return ok(
              `已下载到 ${a.local_path}(${human(size)},耗时 ${(ms / 1000).toFixed(1)}s ${rate(size, ms)})`
            )
          }
          const chunks: Buffer[] = []
          let total = 0
          let over = false
          ch.on('data', (c: Buffer) => {
            total += c.length
            if (total > INLINE_MAX) {
              if (!over) {
                over = true
                ch.close()
              }
              return
            }
            chunks.push(c)
          })
          const end = await done
          if (over) return fail(`文件超过内联上限 ${INLINE_MAX / 1024 / 1024}MB;请传 local_path`)
          if (aborted) return fail(`下载中断:${aborted}`)
          if (end.code !== 0) return fail(end.stderr || `下载失败(退出码 ${end.code})`)
          return ok(inlineResult(a.remote_path, Buffer.concat(chunks)))
        } finally {
          release()
        }
      }
    )
  )

  server.registerTool(
    'transfer_between_hosts',
    {
      description:
        '在两台服务器(或容器)之间直接复制文件或目录,数据经 NebuShell 中转,不经过你的上下文,' +
        '适合把构建产物 / 镜像包 / 配置分发到另一台机器。源是文件时 dest_path 是目标文件路径;' +
        '源是目录时 dest_path 是目标目录(自动创建,源目录的内容复制进去,用 tar 流保留权限)。' +
        '源和目标可以是同一台主机(例如宿主机 ↔ 容器)。',
      inputSchema: {
        source_host: z.string(),
        source_path: z.string(),
        dest_host: z.string(),
        dest_path: z.string(),
        source_container: z.string().optional(),
        dest_container: z.string().optional(),
        timeout_seconds: timeoutArg
      }
    },
    wrap(
      'transfer_between_hosts',
      clientIp,
      (a: {
        source_host: string
        source_path: string
        dest_host: string
        dest_path: string
        source_container?: string
        dest_container?: string
      }) =>
        `${a.source_host}${a.source_container ? `/${a.source_container}` : ''}:${a.source_path} → ` +
        `${a.dest_host}${a.dest_container ? `/${a.dest_container}` : ''}:${a.dest_path}`,
      async (
        a: {
          source_host: string
          source_path: string
          dest_host: string
          dest_path: string
          source_container?: string
          dest_container?: string
          timeout_seconds?: number
        },
        extra
      ) => {
        const src = resolveHost(a.source_host)
        const dst = resolveHost(a.dest_host)
        const kind = await kindOf(src, a.source_container, a.source_path)
        if (kind === 'none') return fail(`源路径不存在: ${a.source_path}`)
        const [srcScript, dstScript] =
          kind === 'dir'
            ? ['cd "$1" && tar -cf - .', 'mkdir -p "$1" && cd "$1" && tar -xf -']
            : ['cat -- "$1"', 'mkdir -p "$(dirname "$1")" && cat > "$1"']
        const srcCmd = await inTarget(src, a.source_container, srcScript, { args: [a.source_path] })
        const dstCmd = await inTarget(dst, a.dest_container, dstScript, {
          interactive: true,
          args: [a.dest_path]
        })
        const started = Date.now()
        const out = await mcpSshPool.channel(dst, dstCmd)
        const dstDone = channelDone(out)
        out.resume()
        let inp: ClientChannel
        try {
          inp = await mcpSshPool.channel(src, srcCmd)
        } catch (e) {
          out.close()
          throw e
        }
        const srcDone = channelDone(inp)
        let bytes = 0
        inp.on('data', (c: Buffer) => (bytes += c.length))
        let aborted = ''
        const release = guard(
          [inp, out],
          a.timeout_seconds ?? DEFAULT_TRANSFER_TIMEOUT_S,
          extra,
          (w) => (aborted = w)
        )
        try {
          inp.pipe(out) // 源读完自动给目标发 EOF
          const [s, d] = await Promise.all([srcDone, dstDone])
          if (aborted) return fail(`传输中断:${aborted}(已传 ${human(bytes)})`)
          if (s.code !== 0) return fail(`读取源失败(退出码 ${s.code}): ${s.stderr}`)
          if (d.code !== 0) return fail(`写入目标失败(退出码 ${d.code}): ${d.stderr}`)
        } finally {
          release()
        }
        const ms = Date.now() - started
        return ok(
          `已复制${kind === 'dir' ? '目录' : '文件'} ${src.label}:${a.source_path} → ${dst.label}` +
            `${a.dest_container ? ` 容器 ${a.dest_container}` : ''}:${a.dest_path}` +
            `(${human(bytes)}${kind === 'dir' ? ' tar 流' : ''},耗时 ${(ms / 1000).toFixed(1)}s ${rate(bytes, ms)})`
        )
      }
    )
  )
}

/** 远端路径永远是 POSIX 风格,不能用 Node 的 path.dirname(Windows 上会按 \ 处理)。 */
function dirnamePosix(p: string): string {
  const i = p.replace(/\/+$/, '').lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

function withTimeout<T>(p: Promise<T>, timeoutS: number, extra: ToolExtra): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`超过 ${timeoutS} 秒未完成`)), timeoutS * 1000)
    const onAbort = (): void => reject(new Error('客户端已取消'))
    extra.signal.addEventListener('abort', onAbort)
    p.then(resolve, reject).finally(() => {
      clearTimeout(timer)
      extra.signal.removeEventListener('abort', onAbort)
    })
  })
}

function inlineResult(path: string, buf: Buffer): string {
  return [
    `path: ${path}`,
    `size: ${buf.length}`,
    'encoding: base64',
    '---',
    buf.toString('base64')
  ].join('\n')
}
