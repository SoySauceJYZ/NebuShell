import { Client, type SFTPWrapper, type Stats } from 'ssh2'
import { createWriteStream, createReadStream, promises as fsp } from 'fs'
import { basename as localBasename, join as localJoin } from 'path'
import type { Readable, Writable } from 'stream'
import type { SshConnectOptions, SftpListEntry, TransferProgress } from '../../shared/types'
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

/** basename that tolerates both '/' and '\\' separators (remote or local input). */
export function anyBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

export class SftpManager {
  private sessions = new Map<string, SftpSession>()

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

  remove(sessionId: string, remotePath: string, isDirectory: boolean): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    return new Promise((resolve, reject) => {
      if (isDirectory) {
        sftp.rmdir(remotePath, (err) => (err ? reject(err) : resolve()))
      } else {
        sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve()))
      }
    })
  }

  download(sessionId: string, remotePath: string, localPath: string): Promise<void> {
    const { sftp } = this.getSession(sessionId)
    return new Promise((resolve, reject) => {
      const readStream = sftp.createReadStream(remotePath)
      const writeStream = createWriteStream(localPath)
      readStream.on('error', reject)
      writeStream.on('error', reject)
      writeStream.on('close', () => resolve())
      readStream.pipe(writeStream)
    })
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
    return new Promise((resolve, reject) => {
      const readStream = createReadStream(localPath)
      const writeStream = sftp.createWriteStream(remotePath)
      readStream.on('error', reject)
      writeStream.on('error', reject)
      writeStream.on('close', () => resolve())
      readStream.pipe(writeStream)
    })
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
      (e) => ({ read: createReadStream(e.srcPath), write: sftp.createWriteStream(e.dstPath) })
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
      (e) => ({ read: sftp.createReadStream(e.srcPath), write: createWriteStream(e.dstPath) })
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
      (e) => ({ read: srcSftp.createReadStream(e.srcPath), write: dstSftp.createWriteStream(e.dstPath) })
    )
  }

  /** Two-pass executor: scan builds the plan + totals, then transfer sequentially. */
  private async runTransfer(
    onProgress: ProgressCb | undefined,
    scan: (add: (e: PlanEntry) => void) => Promise<void>,
    makeDir: (dstPath: string) => Promise<void>,
    makeStreams: (e: PlanEntry) => { read: Readable; write: Writable }
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
          const { read, write } = makeStreams(item)
          await this.streamCopy(read, write, (n) => {
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
  private async scanLocal(
    src: string,
    dst: string,
    add: (e: PlanEntry) => void
  ): Promise<void> {
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
        await this.scanRemote(sftp, posixJoin(src, child.name), joinDst(dst, child.name), joinDst, add)
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

  private streamCopy(
    read: Readable,
    write: Writable,
    onBytes: (n: number) => void
  ): Promise<void> {
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
  }
}

export const sftpManager = new SftpManager()
