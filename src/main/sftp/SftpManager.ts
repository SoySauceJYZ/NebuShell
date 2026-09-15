import { Client, type SFTPWrapper, type Stats } from 'ssh2'
import { promises as fsp } from 'fs'
import { basename as localBasename, join as localJoin } from 'path'
import type { Readable, Writable } from 'stream'
import type {
  SshConnectOptions,
  SftpListEntry,
  TransferProgress,
  TransferPlan
} from '../../shared/types'
import {
  DEFAULT_TRANSFER_CONCURRENCY,
  MIN_TRANSFER_CONCURRENCY,
  MAX_TRANSFER_CONCURRENCY
} from '../../shared/types'
import { SAFE_ALGORITHMS, SAFE_KEEPALIVE_INTERVAL } from '../ssh/algorithms'
import { createNoDelaySocket } from '../ssh/createSocket'

interface SftpSession {
  client: Client
  sftp: SFTPWrapper
}

/** Progress callback used by the recursive transfer helpers. */
type ProgressCb = (p: Omit<TransferProgress, 'transferId'>) => void

/** One node of a scanned transfer tree. */
interface PlanEntry {
  srcPath: string
  dstPath: string
  isDir: boolean
  size: number
}

function joinRemotePath(dir: string, name: string): string {
  if (dir.endsWith('/')) return `${dir}${name}`
  return `${dir}/${name}`
}

/** POSIX-style join for remote paths (never use path.join on Windows for remote). */
export function posixJoin(dir: string, name: string): string {
  const d = dir.replace(/\/+$/, '')
  return d === '' ? `/${name}` : `${d}/${name}`
}

/** 探测 shell 可用性的回显标记与上限。 */
const SHELL_PROBE_MARKER = 'NEBU_SHELL_OK'
const SHELL_PROBE_TIMEOUT_MS = 3000

/** 一条 `rm -rf` 里最多带多少个路径(命令行长度上限的保守取值)。 */
const REMOVE_BATCH = 60

/** 为远端 shell 安全地单引号包裹一个路径。 */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`
}

/** basename that tolerates both '/' and '\\' separators (remote or local input). */
export function anyBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

export class SftpManager {
  private sessions = new Map<string, SftpSession>()
  /** 每条会话能否用 exec 跑 shell 命令(删除走 rm -rf 还是协议递归)。 */
  private shellOk = new Map<string, boolean>()

  async connect(opts: SshConnectOptions): Promise<void> {
    const sock = await createNoDelaySocket(opts.host, opts.port)

    return new Promise((resolve, reject) => {
      const client = new Client()
      client
        .on('ready', () => {
          client.sftp((err, sftp) => {
            if (err) {
              reject(err)
              return
            }
            this.sessions.set(opts.sessionId, { client, sftp })
            resolve()
          })
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

  private getSession(sessionId: string): SftpSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('SFTP session not found')
    return session
  }

  list(sessionId: string, remotePath: string): Promise<SftpListEntry[]> {
    const { sftp } = this.getSession(sessionId)
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(err)
          return
        }
        const entries: SftpListEntry[] = list.map((item) => {
          const isDir = item.attrs.isDirectory()
          const isLink = item.attrs.isSymbolicLink()
          return {
            name: item.filename,
            path: joinRemotePath(remotePath, item.filename),
            type: isDir ? 'directory' : isLink ? 'symlink' : 'file',
            size: item.attrs.size ?? 0,
            modifyTime: (item.attrs.mtime ?? 0) * 1000,
            permissions: item.longname.split(' ')[0] ?? ''
          }
        })
        resolve(entries)
      })
    })
  }

  mkdir(sessionId: string, remotePath: string): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => (err ? reject(err) : resolve()))
    })
  }

  rename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve()))
    })
  }

  /** 单条删除:等价于删一批里只有一条(目录同样是递归删除)。 */
  remove(sessionId: string, remotePath: string): Promise<void> {
    return this.removePaths(sessionId, [remotePath])
  }

  /**
   * 删除一批远端路径,**目录非空也删**。
   *
   * 首选在同一条 SSH 连接上执行 `rm -rf`:非空目录一条命令就能删掉,多个路径也只要一次
   * 往返(SFTP 协议得一层层 readdir/unlink/rmdir,深目录要成百上千次往返)。
   * 账户被限制成纯 SFTP(ForceCommand internal-sftp)时没有 shell,exec 会失败,
   * 这时退回按协议递归删除 —— 慢,但仍然能把非空目录删干净。
   */
  async removePaths(sessionId: string, remotePaths: string[]): Promise<void> {
    const paths = remotePaths.filter((p) => p && p !== '/')
    if (paths.length === 0) return
    try {
      if (!(await this.canRunShell(sessionId))) throw new Error('NO_SHELL')
      // 命令行长度有限,分批下发(每批 60 条,远低于常见的 ARG_MAX)。
      for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        await this.execRemove(sessionId, paths.slice(i, i + REMOVE_BATCH))
      }
      return
    } catch (err) {
      // 没有 shell / 没有 rm:退回协议递归删除。权限不足之类的错误在这条路上
      // 会以更具体的「哪个文件删不掉」形式再报一次。
      const { sftp } = this.getSession(sessionId)
      let lastErr: unknown = err
      let ok = false
      for (const p of paths) {
        try {
          await this.removeRecursive(sftp, p)
          ok = true
        } catch (e) {
          lastErr = e
        }
      }
      if (!ok) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    }
  }

  /**
   * 这条连接能不能用 exec 跑 shell 命令?每个会话只探一次(结果缓存)。
   *
   * 必须先探:被 `ForceCommand internal-sftp` 限制的账户,exec 请求本身是**成功**的,
   * 只是跑起来的是 sftp 子系统而不是你的命令 —— 通道会一直等 SFTP 报文,既不出错也不退出。
   * 直接下发 rm 就会永久挂住。探测用一条 echo + 3 秒上限,拿不到回显即判定没有 shell。
   */
  private async canRunShell(sessionId: string): Promise<boolean> {
    const cached = this.shellOk.get(sessionId)
    if (cached !== undefined) return cached
    const ok = await this.probeShell(sessionId)
    this.shellOk.set(sessionId, ok)
    return ok
  }

  private probeShell(sessionId: string): Promise<boolean> {
    const { client } = this.getSession(sessionId)
    return new Promise((resolve) => {
      let settled = false
      const done = (v: boolean, channel?: { close: () => void }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          channel?.close()
        } catch {
          // 通道可能已经关了
        }
        resolve(v)
      }
      const timer = setTimeout(() => done(false), SHELL_PROBE_TIMEOUT_MS)
      client.exec(`echo ${SHELL_PROBE_MARKER}`, (err, stream) => {
        if (err || !stream) {
          done(false)
          return
        }
        let out = ''
        stream.on('data', (c: Buffer) => {
          out += c.toString('utf8')
          if (out.includes(SHELL_PROBE_MARKER)) done(true, stream)
        })
        stream.on('close', () => done(out.includes(SHELL_PROBE_MARKER)))
        stream.on('error', () => done(false))
      })
    })
  }

  /** 在 SFTP 会话自己的 SSH 连接上跑 `rm -rf`。 */
  private execRemove(sessionId: string, paths: string[]): Promise<void> {
    const { client } = this.getSession(sessionId)
    const command = `rm -rf -- ${paths.map(shellQuote).join(' ')}`
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err)
          return
        }
        let stderr = ''
        let code: number | null = null
        stream.on('data', () => {})
        stream.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
        stream.on('exit', (c: number | null) => (code = c))
        stream.on('close', () => {
          if (code === 0) resolve()
          else reject(new Error(stderr.trim() || `rm 退出码 ${code ?? '未知'}`))
        })
        stream.on('error', (e: Error) => reject(e))
      })
    })
  }

  /** 纯 SFTP 协议的递归删除(没有 shell 时的兜底)。用 lstat,符号链接只删链接本身。 */
  private async removeRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    const st = await new Promise<Stats>((resolve, reject) =>
      sftp.lstat(remotePath, (err, s) => (err ? reject(err) : resolve(s)))
    )
    if (st.isDirectory()) {
      const entries = await new Promise<Array<{ filename: string }>>((resolve, reject) =>
        sftp.readdir(remotePath, (err, list) => (err ? reject(err) : resolve(list)))
      )
      for (const e of entries) {
        if (e.filename === '.' || e.filename === '..') continue
        await this.removeRecursive(sftp, posixJoin(remotePath, e.filename))
      }
      await new Promise<void>((resolve, reject) =>
        sftp.rmdir(remotePath, (err) => (err ? reject(err) : resolve()))
      )
      return
    }
    await new Promise<void>((resolve, reject) =>
      sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve()))
    )
  }

  download(sessionId: string, remotePath: string, localPath: string): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    // fastGet (concurrent reads) is far faster than a serial piped stream on latency links.
    return this.fastGetFile(sftp, remotePath, localPath, () => {})
  }

  private static readonly MAX_EDIT_BYTES = 2 * 1024 * 1024

  readFile(sessionId: string, remotePath: string): Promise<string> {
    const { sftp } = this.getSession(sessionId)
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) {
          reject(statErr)
          return
        }
        if ((stats.size ?? 0) > SftpManager.MAX_EDIT_BYTES) {
          reject(new Error('文件过大,无法在编辑器中打开(上限 2MB)'))
          return
        }
        sftp.readFile(remotePath, (err, buf) => {
          if (err) reject(err)
          else resolve(buf.toString('utf8'))
        })
      })
    })
  }

  writeFile(sessionId: string, remotePath: string, content: string): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    return new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), (err) =>
        err ? reject(err) : resolve()
      )
    })
  }

  upload(sessionId: string, localPath: string, remotePath: string): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    // fastPut (concurrent writes) is far faster than a serial piped stream on latency links.
    return this.fastPutFile(sftp, localPath, remotePath, () => {})
  }

  // ---- Recursive transfers (upload / download / cross-host) with progress ----

  /** Local file or directory (recursive) -> remote directory. */
  async uploadPath(
    sessionId: string,
    localPath: string,
    remoteDir: string,
    onProgress?: ProgressCb
  ): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    const rootDst = posixJoin(remoteDir, localBasename(localPath))
    await this.runTransfer(
      onProgress,
      (add) => this.scanLocal(localPath, rootDst, add),
      (dst) => this.mkdirRemoteSafe(sftp, dst),
      // fastPut pipelines many concurrent SFTP writes -> saturates high-latency links.
      (e, onBytes) => this.fastPutFile(sftp, e.srcPath, e.dstPath, onBytes)
    )
  }

  /** Remote file or directory (recursive) -> local directory, preserving name. */
  async downloadPath(
    sessionId: string,
    remotePath: string,
    localDir: string,
    onProgress?: ProgressCb
  ): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    const rootDst = localJoin(localDir, anyBasename(remotePath))
    await this.runTransfer(
      onProgress,
      (add) => this.scanRemote(sftp, remotePath, rootDst, localJoin, add),
      async (dst) => {
        await fsp.mkdir(dst, { recursive: true })
      },
      // fastGet pipelines many concurrent SFTP reads -> saturates high-latency links.
      (e, onBytes) => this.fastGetFile(sftp, e.srcPath, e.dstPath, onBytes)
    )
  }

  /** Remote (A) file/dir (recursive) -> remote (B) directory, streaming A -> B. */
  async transferRemoteToRemote(
    srcSessionId: string,
    srcPath: string,
    dstSessionId: string,
    dstDir: string,
    onProgress?: ProgressCb
  ): Promise<void> {
    const { sftp: srcSftp } = this.getSession(srcSessionId)
    const { sftp: dstSftp } = this.getSession(dstSessionId)
    const rootDst = posixJoin(dstDir, anyBasename(srcPath))
    await this.runTransfer(
      onProgress,
      (add) => this.scanRemote(srcSftp, srcPath, rootDst, posixJoin, add),
      (dst) => this.mkdirRemoteSafe(dstSftp, dst),
      // No fast path exists for remote->remote; stream A -> B (larger buffer to help throughput).
      (e, onBytes) =>
        this.streamCopy(
          srcSftp.createReadStream(e.srcPath, { highWaterMark: SftpManager.STREAM_HWM }),
          dstSftp.createWriteStream(e.dstPath, { highWaterMark: SftpManager.STREAM_HWM }),
          onBytes
        )
    )
  }

  /**
   * Dry run: walk a remote file/dir and report what a transfer *would* move,
   * without moving anything. Reuses the same scanner as the real transfer, so
   * the totals match (symlinks skipped either way). RTT-bound on deep trees.
   */
  async planPath(sessionId: string, remotePath: string): Promise<TransferPlan> {
    const { sftp } = this.getSession(sessionId)
    let totalBytes = 0
    let totalFiles = 0
    await this.scanRemote(sftp, remotePath, '', posixJoin, (e) => {
      if (e.isDir) return
      totalBytes += e.size
      totalFiles += 1
    })
    return { totalFiles, totalBytes }
  }

  // ---- Transfer tuning ----
  // Concurrent outstanding SFTP packets per file for fastGet/fastPut. High concurrency
  // is what fills a high-latency link; without it a single serial stream is RTT-bound.
  // User-configurable via settings; see setConcurrency().
  private concurrency = DEFAULT_TRANSFER_CONCURRENCY
  private static readonly TRANSFER_CHUNK = 32768
  // Buffer size for the remote->remote streaming fallback.
  private static readonly STREAM_HWM = 1024 * 1024

  /** Set the fastGet/fastPut concurrency (clamped to the allowed range). */
  setConcurrency(n: number): void {
    const v = Math.round(n)
    if (!Number.isFinite(v)) return
    this.concurrency = Math.min(MAX_TRANSFER_CONCURRENCY, Math.max(MIN_TRANSFER_CONCURRENCY, v))
  }

  /** Two-pass executor: scan builds the plan + totals, then transfer sequentially. */
  private async runTransfer(
    onProgress: ProgressCb | undefined,
    scan: (add: (e: PlanEntry) => void) => Promise<void>,
    makeDir: (dstPath: string) => Promise<void>,
    copyFile: (e: PlanEntry, onBytes: (n: number) => void) => Promise<void>
  ): Promise<void> {
    const plan: PlanEntry[] = []
    let totalBytes = 0
    let totalFiles = 0
    let doneBytes = 0
    let doneFiles = 0
    let lastEmit = 0

    const emit = (phase: TransferProgress['phase'], currentPath?: string, force = false): void => {
      if (!onProgress) return
      const now = Date.now()
      if (!force && now - lastEmit < 100) return
      lastEmit = now
      onProgress({ phase, currentPath, doneBytes, totalBytes, doneFiles, totalFiles })
    }

    try {
      await scan((e) => {
        plan.push(e)
        if (!e.isDir) {
          totalBytes += e.size
          totalFiles += 1
        }
        emit('scan', e.srcPath)
      })

      for (const item of plan) {
        if (item.isDir) {
          await makeDir(item.dstPath)
        } else {
          await copyFile(item, (n) => {
            doneBytes += n
            emit('transfer', item.dstPath)
          })
          doneFiles += 1
          emit('transfer', item.dstPath, true)
        }
      }
      emit('done', undefined, true)
    } catch (err) {
      if (onProgress) {
        onProgress({
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
          doneBytes,
          totalBytes,
          doneFiles,
          totalFiles
        })
      }
      throw err
    }
  }

  /** Walk a local tree (skips symlinks to avoid loops). */
  private async scanLocal(src: string, dst: string, add: (e: PlanEntry) => void): Promise<void> {
    const st = await fsp.lstat(src)
    if (st.isSymbolicLink()) return
    if (st.isDirectory()) {
      add({ srcPath: src, dstPath: dst, isDir: true, size: 0 })
      for (const name of await fsp.readdir(src)) {
        await this.scanLocal(localJoin(src, name), posixJoin(dst, name), add)
      }
    } else if (st.isFile()) {
      add({ srcPath: src, dstPath: dst, isDir: false, size: st.size })
    }
  }

  /** Walk a remote tree (skips symlinks). joinDst picks local vs remote joining. */
  private async scanRemote(
    sftp: SFTPWrapper,
    src: string,
    dst: string,
    joinDst: (dir: string, name: string) => string,
    add: (e: PlanEntry) => void
  ): Promise<void> {
    const st = await this.lstatRemote(sftp, src)
    if (st.isSymbolicLink()) return
    if (st.isDirectory()) {
      add({ srcPath: src, dstPath: dst, isDir: true, size: 0 })
      for (const child of await this.readdirRemote(sftp, src)) {
        await this.scanRemote(
          sftp,
          posixJoin(src, child.name),
          joinDst(dst, child.name),
          joinDst,
          add
        )
      }
    } else {
      add({ srcPath: src, dstPath: dst, isDir: false, size: st.size ?? 0 })
    }
  }

  private lstatRemote(sftp: SFTPWrapper, p: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      sftp.lstat(p, (err, stats) => (err ? reject(err) : resolve(stats)))
    })
  }

  private readdirRemote(sftp: SFTPWrapper, p: string): Promise<{ name: string }[]> {
    return new Promise((resolve, reject) => {
      sftp.readdir(p, (err, list) => {
        if (err) reject(err)
        else resolve(list.map((i) => ({ name: i.filename })))
      })
    })
  }

  private mkdirRemoteSafe(sftp: SFTPWrapper, p: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.mkdir(p, (err) => {
        // code 4 == SSH_FX_FAILURE, which is what most servers return for EEXIST.
        if (err && (err as NodeJS.ErrnoException & { code?: number }).code !== 4) reject(err)
        else resolve()
      })
    })
  }

  /** Local -> remote single file via fastPut (concurrent SFTP writes). */
  private fastPutFile(
    sftp: SFTPWrapper,
    localPath: string,
    remotePath: string,
    onBytes: (n: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let prev = 0
      sftp.fastPut(
        localPath,
        remotePath,
        {
          concurrency: this.concurrency,
          chunkSize: SftpManager.TRANSFER_CHUNK,
          // step reports cumulative bytes for this file; convert to a delta.
          step: (transferred) => {
            onBytes(transferred - prev)
            prev = transferred
          }
        },
        (err) => (err ? reject(err) : resolve())
      )
    })
  }

  /** Remote -> local single file via fastGet (concurrent SFTP reads). */
  private fastGetFile(
    sftp: SFTPWrapper,
    remotePath: string,
    localPath: string,
    onBytes: (n: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let prev = 0
      sftp.fastGet(
        remotePath,
        localPath,
        {
          concurrency: this.concurrency,
          chunkSize: SftpManager.TRANSFER_CHUNK,
          step: (transferred) => {
            onBytes(transferred - prev)
            prev = transferred
          }
        },
        (err) => (err ? reject(err) : resolve())
      )
    })
  }

  private streamCopy(read: Readable, write: Writable, onBytes: (n: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const onErr = (e: Error): void => {
        read.destroy()
        write.destroy()
        reject(e)
      }
      read.on('error', onErr)
      write.on('error', onErr)
      read.on('data', (chunk: string | Buffer) => onBytes(chunk.length))
      write.on('close', () => resolve())
      read.pipe(write)
    })
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.client.end()
      this.sessions.delete(sessionId)
    }
    this.shellOk.delete(sessionId)
  }
}

export const sftpManager = new SftpManager()
