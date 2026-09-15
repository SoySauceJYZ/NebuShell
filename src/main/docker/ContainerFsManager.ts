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
import { mapDockerError } from '../../shared/dockerErrors'
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

// docker cp 兜底列目录的上限(整棵子树都会进 tar,所以必须能提前收手)。
const TAR_LIST_MAX_ENTRIES = 20_000
const TAR_LIST_MAX_BYTES = 64 * 1024 * 1024
const TAR_LIST_MAX_MS = 15_000

/** docker exec 用不了(容器没运行 / 镜像里没有该二进制)—— 此时改走 docker cp 兜底。 */
const EXEC_UNAVAILABLE_RE =
  /is not running|is paused|executable file not found|OCI runtime exec failed|starting container process caused|no such file or directory/i

/** 把 tar 头里的权限位还原成 ls 那样的 'drwxr-xr-x' 字符串。 */
function formatMode(type: TarEntryMeta['type'], mode: number): string {
  const head = type === 'directory' ? 'd' : type === 'symlink' ? 'l' : type === 'other' ? '?' : '-'
  const rwx = (m: number): string =>
    `${m & 4 ? 'r' : '-'}${m & 2 ? 'w' : '-'}${m & 1 ? 'x' : '-'}`
  return head + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7)
}

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

// 报错映射搬到 shared/dockerErrors.ts,与渲染层的容器面板共用同一份措辞。

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

  /**
   * 跑一条命令,stdout 逐块回调(tar 流下载),可选字节上限。
   * 回调返回 'stop' 表示「要的已经够了」:主动关掉通道并以 truncated 正常返回,
   * 而不是当成错误(列目录的兜底路径靠这个提前掐断整棵子树的 tar 流)。
   */
  private async execStreamOut(
    sessionId: string,
    command: string,
    onStdout: (chunk: Buffer) => void | 'stop',
    opts: { maxBytes?: number } = {}
  ): Promise<{ code: number; stderr: string; truncated: boolean }> {
    const channel = await this.openExec(sessionId, command)
    return new Promise((resolve, reject) => {
      let stderr = ''
      let code = 0
      let seen = 0
      let settled = false
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
      }
      channel.on('data', (c: Buffer) => {
        if (settled) return
        seen += c.length
        if (opts.maxBytes && seen > opts.maxBytes) {
          channel.close()
          settle(() => reject(new Error('OVERFLOW')))
          return
        }
        if (onStdout(c) === 'stop') {
          channel.close()
          settle(() => resolve({ code: 0, stderr, truncated: true }))
        }
      })
      channel.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
      channel.on('exit', (c: number | null) => (code = c ?? 1))
      channel.on('close', () => settle(() => resolve({ code, stderr, truncated: false })))
      channel.on('error', (err: Error) => settle(() => reject(err)))
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

  /**
   * 列目录,并说明是怎么列出来的:
   * - viaTar:走了 docker cp 兜底(容器已停止 / 镜像里没有 ls),
   * - truncated:兜底路径触顶提前中止,列表可能不完整。
   * UI 据此给用户一条明确的提示,而不是让人对着半截列表猜。
   */
  async listInfo(
    sessionId: string,
    path: string
  ): Promise<{ entries: SftpListEntry[]; viaTar: boolean; truncated: boolean }> {
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
    if (res.code === 0) {
      return { entries: parseLsOutput(res.stdout.toString('utf8'), path, gnuTime), viaTar: false, truncated: false }
    }
    // exec 用不了 —— 容器已停止,或镜像里根本没有 ls(distroless)。docker cp 对这两种
    // 情况都照样工作,于是改从 tar 流的头信息里还原出这一层的目录项。
    if (!EXEC_UNAVAILABLE_RE.test(res.stderr)) throw new Error(mapDockerError(res.stderr))
    return this.listViaTar(sessionId, path)
  }

  /** 列目录(只要条目)。目录树适配器等只关心内容的地方用这个。 */
  async list(sessionId: string, path: string): Promise<SftpListEntry[]> {
    return (await this.listInfo(sessionId, path)).entries
  }

  /**
   * 用 `docker cp <容器>:<目录> -` 的 tar 流列目录 —— 容器**停止着也能用**,也不需要
   * 容器内有 ls。代价是 docker 会把整棵子树都打进 tar:我们只读头、丢数据,并且在
   * 条目数/字节数/耗时任一触顶时主动掐断通道,用已经拿到的那部分给出列表。
   * 因此这是 exec 不可用时的兜底,而不是常规路径。
   */
  private async listViaTar(
    sessionId: string,
    path: string
  ): Promise<{ entries: SftpListEntry[]; viaTar: boolean; truncated: boolean }> {
    const { containerId, dockerCmd } = this.getSession(sessionId)
    const entries: SftpListEntry[] = []
    const seen = new Set<string>()
    // tar 里的条目名以「被复制项的 basename」为根:/etc/nginx → 'nginx/...';根目录为空。
    const rootName = posixBasename(path).replace(/^\/+$/, '')
    let count = 0
    const extractor = new TarExtractor({
      onEntry: (meta: TarEntryMeta) => {
        count++
        // 去掉根前缀、'./' 与前导 '/',只留相对路径;再只收第一层(不含 '/' 的那些)。
        // 注意根目录那一趟:`docker cp 容器:/ -` 给出的条目名是 '/'、'/bin/' 这样**带前导
        // 斜杠**的,和复制子目录时('myapp/conf.txt')不一样,不剥掉就会一条都留不下。
        let rel = meta.name
          .replace(/^\.\//, '')
          .replace(/^\/+/, '')
          .replace(/\/+$/, '')
        if (rootName) {
          if (rel === rootName) return
          if (rel.startsWith(`${rootName}/`)) rel = rel.slice(rootName.length + 1)
          else return
        }
        if (!rel || rel.includes('/') || seen.has(rel)) return
        seen.add(rel)
        entries.push({
          name: rel,
          path: posixJoin(path, rel),
          type: meta.type,
          size: meta.size,
          modifyTime: meta.mtime * 1000,
          permissions: formatMode(meta.type, meta.mode)
        })
      },
      onData: () => {},
      onEntryEnd: () => {}
    })
    const startedAt = Date.now()
    try {
      const res = await this.execStreamOut(
        sessionId,
        `${dockerCmd} cp ${shq(`${containerId}:${path}`)} -`,
        (c) => {
          extractor.push(c)
          // 条目数或耗时触顶就收手:整棵子树可能极大,我们只需要最上面那一层。
          if (count >= TAR_LIST_MAX_ENTRIES || Date.now() - startedAt > TAR_LIST_MAX_MS) {
            return 'stop'
          }
          return undefined
        },
        { maxBytes: TAR_LIST_MAX_BYTES }
      )
      if (res.code !== 0 && entries.length === 0) throw new Error(mapDockerError(res.stderr))
      return { entries, viaTar: true, truncated: res.truncated }
    } catch (err) {
      // 字节超限:已经读到的那一部分照常返回,只是标记为不完整。
      if (err instanceof Error && err.message === 'OVERFLOW') {
        return { entries, viaTar: true, truncated: true }
      }
      throw err
    }
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

  /** 多选删除:一条 rm -rf 带上全部选中项(目录非空也删)。 */
  removePaths(sessionId: string, paths: string[]): Promise<void> {
    const list = paths.filter((p) => p && p !== '/')
    if (list.length === 0) return Promise.resolve()
    return this.execSimple(sessionId, `rm -rf -- ${list.map(shq).join(' ')}`)
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
