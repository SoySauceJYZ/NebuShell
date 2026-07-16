// 容器文件后端:SSH 到宿主机(独立 Client,仿 SftpManager),经 docker exec / docker cp
// 操作容器内文件。读写文件与上传下载走 docker cp 的 tar 流(不依赖容器内工具、二进制安全);
// 列目录与 mkdir/mv/rm 走 docker exec(需要容器内有对应 busybox/GNU 工具)。
import { Client, type ClientChannel } from 'ssh2'
import { promises as fsp, createReadStream, createWriteStream } from 'fs'
import { basename as localBasename, join as localJoin } from 'path'
import type {
  ContainerFsConnectOptions,
  SftpListEntry,
  TransferProgress
} from '../../shared/types'
import { SAFE_ALGORITHMS, SAFE_KEEPALIVE_INTERVAL } from '../ssh/algorithms'
import { createNoDelaySocket } from '../ssh/createSocket'
import { posixJoin } from '../sftp/SftpManager'
import { tarHeader, padTo512, TAR_TRAILER, TarExtractor, type TarEntryMeta } from './tar'

interface CfsSession {
  client: Client
  containerId: string
  dockerCmd: string
}

type ProgressCb = (p: Omit<TransferProgress, 'transferId'>) => void

interface PlanEntry {
  srcPath: string
  /** tar 内的相对路径(POSIX,根为被复制项的 basename)。 */
  tarName: string
  isDir: boolean
  size: number
}

const MAX_EDIT_BYTES = 2 * 1024 * 1024

/** 为远程 shell 安全地单引号包裹参数。 */
const shq = (p: string): string => `'${p.replace(/'/g, `'\\''`)}'`

function posixDirname(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i <= 0 ? '/' : t.slice(0, i)
}

function posixBasename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || '/'
}

/** 把 docker 的报错映射成对用户有意义的中文信息。 */
function mapDockerError(stderr: string): string {
  const s = stderr.trim()
  if (/executable file not found|OCI runtime exec failed/i.test(s)) {
    return '容器内没有可用的 shell/工具,无法执行该操作(可能是 distroless 镜像)'
  }
  return s || '操作失败'
}

export class ContainerFsManager {
  private sessions = new Map<string, CfsSession>()

  async connect(opts: ContainerFsConnectOptions): Promise<void> {
    const sock = await createNoDelaySocket(opts.host, opts.port)
    return new Promise((resolve, reject) => {
      const client = new Client()
      client
        .on('ready', () => {
          this.sessions.set(opts.sessionId, {
            client,
            containerId: opts.containerId,
            dockerCmd: opts.dockerCmd
          })
          resolve()
        })
        .on('error', (err) => reject(err))
        .connect({
          sock,
          username: opts.username,
          password: opts.password,
          privateKey: opts.privateKey,
          passphrase: opts.passphrase,
          readyTimeout: 20000,
          algorithms: SAFE_ALGORITHMS,
          keepaliveInterval: SAFE_KEEPALIVE_INTERVAL
        })
    })
  }

  private getSession(sessionId: string): CfsSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('容器会话不存在')
    return session
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.client.end()
      this.sessions.delete(sessionId)
    }
  }

  // ---- exec 基础设施(与 ssh:exec 不同:捕获 exit code + stderr) ------------

  private openExec(sessionId: string, command: string): Promise<ClientChannel> {
    const { client } = this.getSession(sessionId)
    return new Promise((resolve, reject) => {
      client.exec(command, (err, channel) => (err ? reject(err) : resolve(channel)))
    })
  }

  /** 跑一条命令,整体收集 stdout(Buffer)与 stderr(string)。 */
  private async execCapture(
    sessionId: string,
    command: string
  ): Promise<{ code: number; stdout: Buffer; stderr: string }> {
    const channel = await this.openExec(sessionId, command)
    return new Promise((resolve, reject) => {
      const out: Buffer[] = []
      let stderr = ''
      let code = 0
      channel.on('data', (c: Buffer) => out.push(c))
      channel.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
      channel.on('exit', (c: number | null) => (code = c ?? 1))
      channel.on('close', () => resolve({ code, stdout: Buffer.concat(out), stderr }))
      channel.on('error', (err: Error) => reject(err))
    })
  }

  /** 跑一条命令,stdout 逐块回调(tar 流下载),可选字节上限。 */
  private async execStreamOut(
    sessionId: string,
    command: string,
    onStdout: (chunk: Buffer) => void,
    opts: { maxBytes?: number } = {}
  ): Promise<{ code: number; stderr: string }> {
    const channel = await this.openExec(sessionId, command)
    return new Promise((resolve, reject) => {
      let stderr = ''
      let code = 0
      let seen = 0
      let overflow = false
      channel.on('data', (c: Buffer) => {
        seen += c.length
        if (opts.maxBytes && seen > opts.maxBytes && !overflow) {
          overflow = true
          channel.close()
          reject(new Error('OVERFLOW'))
          return
        }
        if (!overflow) onStdout(c)
      })
      channel.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
      channel.on('exit', (c: number | null) => (code = c ?? 1))
      channel.on('close', () => {
        if (!overflow) resolve({ code, stderr })
      })
      channel.on('error', (err: Error) => reject(err))
    })
  }

  /** 打开一条命令的 stdin 写入通道(tar 流上传)。 */
  private async execStreamIn(
    sessionId: string,
    command: string
  ): Promise<{ channel: ClientChannel; done: Promise<{ code: number; stderr: string }> }> {
    const channel = await this.openExec(sessionId, command)
    const done = new Promise<{ code: number; stderr: string }>((resolve, reject) => {
      let stderr = ''
      let code = 0
      channel.on('data', () => {}) // docker cp - 正常无 stdout,消费掉防积压
      channel.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
      channel.on('exit', (c: number | null) => (code = c ?? 1))
      channel.on('close', () => resolve({ code, stderr }))
      channel.on('error', (err: Error) => reject(err))
    })
    return { channel, done }
  }

  private async writeWithBackpressure(channel: ClientChannel, buf: Buffer): Promise<void> {
    if (!channel.write(buf)) {
      await new Promise<void>((resolve) => channel.once('drain', () => resolve()))
    }
  }

  // ---- 目录列表(docker exec + ls,exec 形式直接跑二进制,无嵌套引号) --------

  async list(sessionId: string, path: string): Promise<SftpListEntry[]> {
    const { containerId, dockerCmd } = this.getSession(sessionId)
    // 先试 GNU coreutils(epoch 时间戳,精确),busybox 不认 --time-style 再回退。
    // -n:数字 uid/gid,列数稳定,避免用户名带空格干扰解析。
    let res = await this.execCapture(
      sessionId,
      `${dockerCmd} exec ${containerId} ls -lAn --time-style=+%s -- ${shq(path)}`
    )
    let gnuTime = true
    if (res.code !== 0 && /unrecognized|unknown option|invalid option/i.test(res.stderr)) {
      gnuTime = false
      res = await this.execCapture(
        sessionId,
        `${dockerCmd} exec ${containerId} ls -lAn -- ${shq(path)}`
      )
    }
    if (res.code !== 0) throw new Error(mapDockerError(res.stderr))
    return parseLsOutput(res.stdout.toString('utf8'), path, gnuTime)
  }

  // ---- 编辑器读写(docker cp tar 流,不依赖容器内工具) ----------------------

  async readFile(sessionId: string, path: string): Promise<string> {
    const { containerId, dockerCmd } = this.getSession(sessionId)
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    const extractor = new TarExtractor({
      onEntry: (meta: TarEntryMeta) => {
        if (meta.type === 'file' && meta.size > MAX_EDIT_BYTES) tooBig = true
      },
      onData: (c) => {
        if (tooBig) return
        chunks.push(Buffer.from(c))
        size += c.length
      },
      onEntryEnd: () => {}
    })
    try {
      const res = await this.execStreamOut(
        sessionId,
        `${dockerCmd} cp ${shq(`${containerId}:${path}`)} -`,
        (c) => extractor.push(c),
        { maxBytes: MAX_EDIT_BYTES + 64 * 1024 } // tar 头/padding 余量
      )
      if (res.code !== 0) throw new Error(mapDockerError(res.stderr))
    } catch (err) {
      if (err instanceof Error && err.message === 'OVERFLOW') {
        throw new Error('文件过大,无法在编辑器中打开(上限 2MB)')
      }
      throw err
    }
    if (tooBig || size > MAX_EDIT_BYTES) {
      throw new Error('文件过大,无法在编辑器中打开(上限 2MB)')
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  async writeFile(sessionId: string, path: string, content: string): Promise<void> {
    const { containerId, dockerCmd } = this.getSession(sessionId)
    const data = Buffer.from(content, 'utf8')
    const name = posixBasename(path)
    const padded = Buffer.alloc(padTo512(data.length))
    data.copy(padded)
    const tarBuf = Buffer.concat([tarHeader(name, data.length), padded, TAR_TRAILER])
    const dst = `${containerId}:${posixDirname(path)}`
    const { channel, done } = await this.execStreamIn(
      sessionId,
      `${dockerCmd} cp - ${shq(dst)}`
    )
    await this.writeWithBackpressure(channel, tarBuf)
    channel.end()
    const res = await done
    if (res.code !== 0) throw new Error(mapDockerError(res.stderr))
  }

  // ---- 目录操作(docker exec 直接跑二进制) ---------------------------------

  private async execSimple(sessionId: string, args: string): Promise<void> {
    const { containerId, dockerCmd } = this.getSession(sessionId)
    const res = await this.execCapture(sessionId, `${dockerCmd} exec ${containerId} ${args}`)
    if (res.code !== 0) throw new Error(mapDockerError(res.stderr))
  }

  mkdir(sessionId: string, path: string): Promise<void> {
    return this.execSimple(sessionId, `mkdir -- ${shq(path)}`)
  }

  rename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    return this.execSimple(sessionId, `mv -- ${shq(oldPath)} ${shq(newPath)}`)
  }

  remove(sessionId: string, path: string, isDirectory: boolean): Promise<void> {
    return this.execSimple(
      sessionId,
      isDirectory ? `rm -rf -- ${shq(path)}` : `rm -f -- ${shq(path)}`
    )
  }

  // ---- 上传(本地 → 容器,tar 流灌 docker cp -) -----------------------------

  async uploadPaths(
    sessionId: string,
    containerDir: string,
    localPaths: string[],
    onProgress?: ProgressCb
  ): Promise<void> {
    const { containerId, dockerCmd } = this.getSession(sessionId)
    // 1) 扫描本地树(跳过符号链接,与 SFTP 上传一致)
    const plan: PlanEntry[] = []
    let totalBytes = 0
    let totalFiles = 0
    const scan = async (src: string, tarName: string): Promise<void> => {
      const st = await fsp.lstat(src)
      if (st.isSymbolicLink()) return
      if (st.isDirectory()) {
        plan.push({ srcPath: src, tarName, isDir: true, size: 0 })
        for (const name of await fsp.readdir(src)) {
          await scan(localJoin(src, name), `${tarName}/${name}`)
        }
      } else if (st.isFile()) {
        plan.push({ srcPath: src, tarName, isDir: false, size: st.size })
        totalBytes += st.size
        totalFiles += 1
      }
    }
    for (const p of localPaths) {
      onProgress?.({
        phase: 'scan',
        currentPath: p,
        doneBytes: 0,
        totalBytes,
        doneFiles: 0,
        totalFiles
      })
      await scan(p, localBasename(p))
    }

    // 2) 单条 docker cp - 通道,顺序流式写入 tar
    let doneBytes = 0
    let doneFiles = 0
    let lastEmit = 0
    const emit = (phase: TransferProgress['phase'], currentPath?: string, force = false): void => {
      const now = Date.now()
      if (!force && now - lastEmit < 100) return
      lastEmit = now
      onProgress?.({ phase, currentPath, doneBytes, totalBytes, doneFiles, totalFiles })
    }
    const { channel, done } = await this.execStreamIn(
      sessionId,
      `${dockerCmd} cp - ${shq(`${containerId}:${containerDir}`)}`
    )
    try {
      for (const entry of plan) {
        if (entry.isDir) {
          await this.writeWithBackpressure(channel, tarHeader(entry.tarName, 0, { dir: true }))
          continue
        }
        await this.writeWithBackpressure(channel, tarHeader(entry.tarName, entry.size))
        const stream = createReadStream(entry.srcPath)
        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk: string | Buffer) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            doneBytes += buf.length
            if (!channel.write(buf)) {
              stream.pause()
              channel.once('drain', () => stream.resume())
            }
            emit('transfer', entry.tarName)
          })
          stream.on('end', () => resolve())
          stream.on('error', (e) => reject(e))
        })
        const pad = padTo512(entry.size) - entry.size
        if (pad > 0) await this.writeWithBackpressure(channel, Buffer.alloc(pad))
        doneFiles += 1
        emit('transfer', entry.tarName, true)
      }
      await this.writeWithBackpressure(channel, TAR_TRAILER)
    } finally {
      channel.end()
    }
    const res = await done
    if (res.code !== 0) throw new Error(mapDockerError(res.stderr))
    emit('done', undefined, true)
  }

  // ---- 下载(容器 → 本地,docker cp tar 流落盘) -----------------------------

  async downloadTo(
    sessionId: string,
    containerPath: string,
    localDir: string,
    onProgress?: ProgressCb
  ): Promise<void> {
    const { containerId, dockerCmd } = this.getSession(sessionId)
    // 尽力预估总量(du 不可用则 0,进度按 max(total, done) 兜底)
    let totalBytes = 0
    try {
      const du = await this.execCapture(
        sessionId,
        `${dockerCmd} exec ${containerId} du -sk -- ${shq(containerPath)}`
      )
      if (du.code === 0) {
        const kb = parseInt(du.stdout.toString('utf8').trim().split(/\s+/)[0], 10)
        if (Number.isFinite(kb)) totalBytes = kb * 1024
      }
    } catch {
      // 预估失败无碍
    }

    let doneBytes = 0
    let doneFiles = 0
    let lastEmit = 0
    const emit = (phase: TransferProgress['phase'], currentPath?: string, force = false): void => {
      const now = Date.now()
      if (!force && now - lastEmit < 100) return
      lastEmit = now
      onProgress?.({
        phase,
        currentPath,
        doneBytes,
        totalBytes: Math.max(totalBytes, doneBytes),
        doneFiles,
        totalFiles: Math.max(doneFiles, 1)
      })
    }

    let current: ReturnType<typeof createWriteStream> | null = null
    let channelRef: ClientChannel | null = null
    const pendingWrites: Promise<void>[] = []
    let extractError: Error | null = null

    const extractor = new TarExtractor({
      onEntry: (meta) => {
        const rel = meta.name.replace(/^\.\//, '')
        // 防路径穿越:丢弃包含 .. 的条目
        if (rel.split('/').some((seg) => seg === '..')) return
        const dst = localJoin(localDir, ...rel.split('/'))
        if (meta.type === 'directory') {
          pendingWrites.push(fsp.mkdir(dst, { recursive: true }).then(() => {}))
        } else if (meta.type === 'file') {
          const ws = createWriteStream(dst)
          ws.on('error', (e) => {
            extractError = e
            channelRef?.close()
          })
          current = ws
          emit('transfer', rel)
        }
        // symlink/other:跳过(Windows 宿主上创建 symlink 不可靠)
      },
      onData: (chunk) => {
        const ws = current
        if (!ws) return
        doneBytes += chunk.length
        if (!ws.write(chunk)) {
          channelRef?.pause()
          ws.once('drain', () => channelRef?.resume())
        }
        emit('transfer')
      },
      onEntryEnd: () => {
        const ws = current
        current = null
        if (ws) {
          doneFiles += 1
          pendingWrites.push(new Promise<void>((resolve) => ws.end(() => resolve())))
          emit('transfer', undefined, true)
        }
      }
    })

    await fsp.mkdir(localDir, { recursive: true })
    const channel = await this.openExec(
      sessionId,
      `${dockerCmd} cp ${shq(`${containerId}:${containerPath}`)} -`
    )
    channelRef = channel
    const res = await new Promise<{ code: number; stderr: string }>((resolve, reject) => {
      let stderr = ''
      let code = 0
      channel.on('data', (c: Buffer) => {
        try {
          extractor.push(c)
        } catch (e) {
          extractError = e instanceof Error ? e : new Error(String(e))
          channel.close()
        }
      })
      channel.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
      channel.on('exit', (c: number | null) => (code = c ?? 1))
      channel.on('close', () => resolve({ code, stderr }))
      channel.on('error', (err: Error) => reject(err))
    })
    extractor.finish()
    await Promise.all(pendingWrites)
    if (extractError) throw extractError
    if (res.code !== 0) throw new Error(mapDockerError(res.stderr))
    emit('done', undefined, true)
  }
}

// ---- ls 长格式解析(GNU epoch / busybox 两种时间布局) -------------------------

export function parseLsOutput(out: string, dir: string, gnuTime: boolean): SftpListEntry[] {
  const entries: SftpListEntry[] = []
  for (const line of out.split('\n')) {
    const trimmed = line.trimEnd()
    if (!trimmed || /^total\s/i.test(trimmed)) continue
    const fields = trimmed.split(/\s+/)
    // GNU: perms links uid gid size epoch name...   (>=7 列)
    // busybox: perms links uid gid size Mon DD (HH:MM|YYYY) name... (>=9 列)
    const minCols = gnuTime ? 7 : 9
    if (fields.length < minCols) continue
    const perms = fields[0]
    if (!/^[-dlbcps]/.test(perms)) continue
    const size = parseInt(fields[4], 10)
    let modifyTime = 0
    let name: string
    if (gnuTime) {
      modifyTime = parseInt(fields[5], 10) * 1000
      name = fields.slice(6).join(' ')
    } else {
      const parsed = Date.parse(`${fields[5]} ${fields[6]} ${fields[7]}`)
      modifyTime = Number.isFinite(parsed) ? parsed : 0
      name = fields.slice(8).join(' ')
    }
    const isSymlink = perms.startsWith('l')
    if (isSymlink) {
      const arrow = name.indexOf(' -> ')
      if (arrow > 0) name = name.slice(0, arrow)
    }
    if (!name || name === '.' || name === '..') continue
    entries.push({
      name,
      path: posixJoin(dir, name),
      type: perms.startsWith('d') ? 'directory' : isSymlink ? 'symlink' : perms.startsWith('-') ? 'file' : 'other',
      size: Number.isFinite(size) ? size : 0,
      modifyTime,
      permissions: perms
    })
  }
  return entries
}

export const containerFsManager = new ContainerFsManager()
