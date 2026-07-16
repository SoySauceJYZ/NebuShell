import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { promises as fsp, createReadStream, createWriteStream } from 'fs'
import { spawn } from 'child_process'
import { homedir, tmpdir } from 'os'
import { basename, join, extname } from 'path'
import type { LocalListEntry, TransferProgress, RunShellResult } from '../../shared/types'

const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

function typeOf(isDir: boolean, isSymlink: boolean): LocalListEntry['type'] {
  if (isDir) return 'directory'
  if (isSymlink) return 'symlink'
  return 'file'
}

interface CopyPlanEntry {
  srcPath: string
  dstPath: string
  isDir: boolean
  size: number
}

async function scanLocalTree(
  src: string,
  dst: string,
  add: (e: CopyPlanEntry) => void
): Promise<void> {
  const st = await fsp.lstat(src)
  if (st.isSymbolicLink()) return
  if (st.isDirectory()) {
    add({ srcPath: src, dstPath: dst, isDir: true, size: 0 })
    for (const name of await fsp.readdir(src)) {
      await scanLocalTree(join(src, name), join(dst, name), add)
    }
  } else if (st.isFile()) {
    add({ srcPath: src, dstPath: dst, isDir: false, size: st.size })
  }
}

function streamCopy(src: string, dst: string, onBytes: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const read = createReadStream(src)
    const write = createWriteStream(dst)
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

async function copyRecursive(
  src: string,
  dstDir: string,
  sender: WebContents,
  transferId: string
): Promise<void> {
  const rootDst = join(dstDir, basename(src))
  const plan: CopyPlanEntry[] = []
  let totalBytes = 0
  let totalFiles = 0
  let doneBytes = 0
  let doneFiles = 0
  let lastEmit = 0

  const emit = (phase: TransferProgress['phase'], currentPath?: string, force = false): void => {
    if (sender.isDestroyed()) return
    const now = Date.now()
    if (!force && now - lastEmit < 100) return
    lastEmit = now
    sender.send(`local:progress:${transferId}`, {
      transferId,
      phase,
      currentPath,
      doneBytes,
      totalBytes,
      doneFiles,
      totalFiles
    } satisfies TransferProgress)
  }

  try {
    await scanLocalTree(src, rootDst, (e) => {
      plan.push(e)
      if (!e.isDir) {
        totalBytes += e.size
        totalFiles += 1
      }
      emit('scan', e.srcPath)
    })
    for (const item of plan) {
      if (item.isDir) {
        await fsp.mkdir(item.dstPath, { recursive: true })
      } else {
        await streamCopy(item.srcPath, item.dstPath, (n) => {
          doneBytes += n
          emit('transfer', item.dstPath)
        })
        doneFiles += 1
        emit('transfer', item.dstPath, true)
      }
    }
    emit('done', undefined, true)
  } catch (err) {
    if (!sender.isDestroyed()) {
      sender.send(`local:progress:${transferId}`, {
        transferId,
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
        doneBytes,
        totalBytes,
        doneFiles,
        totalFiles
      } satisfies TransferProgress)
    }
    throw err
  }
}

// ---- 智能体本机命令执行 ----------------------------------------------------
// 每次调用都 spawn 一个全新的 shell 进程(win32 → PowerShell,posix → /bin/sh),
// 超时语义与 SshManager.runInShell 对齐:静默 12s / 硬上限 180s / 输出 1MB 上限。

const EXEC_IDLE_MS = 12_000
const EXEC_HARD_MS = 180_000
const EXEC_MAX_OUTPUT = 1024 * 1024

async function runLocalShell(command: string): Promise<RunShellResult> {
  const isWin = process.platform === 'win32'
  let scriptDir: string | undefined
  let child: ReturnType<typeof spawn>
  if (isWin) {
    // 用临时 .ps1 + -File 执行(而不是 -Command/-EncodedCommand):后者在 stderr 被重定向时
    // 会把错误/进度流序列化成 CLIXML(#< CLIXML + XML 块),污染喂给模型的输出;-File 输出纯文本。
    // 脚本文件带 UTF-8 BOM,保证 PowerShell 5.1 正确解析中文命令。
    // [Console]::OutputEncoding=UTF8 把控制台输出代码页切到 65001,使 ipconfig/tasklist
    // 等原生程序(中文 Windows 默认 GBK 输出)改为 UTF-8,PowerShell 也按 UTF-8 解码;
    // $OutputEncoding=UTF8 保证管道喂给原生程序的中文不坏。
    const script = [
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
      '$OutputEncoding=[System.Text.Encoding]::UTF8',
      "$ProgressPreference='SilentlyContinue'",
      command,
      'if ($LASTEXITCODE -ne $null) { exit $LASTEXITCODE } elseif ($?) { exit 0 } else { exit 1 }'
    ].join('\r\n')
    scriptDir = await fsp.mkdtemp(join(tmpdir(), 'nebu-agent-'))
    const scriptPath = join(scriptDir, 'cmd.ps1')
    // 字符串开头的不可见字符是 UTF-8 BOM(U+FEFF),PowerShell 5.1 据此按 UTF-8 解析脚本中的中文。
    await fsp.writeFile(scriptPath, '﻿' + script, 'utf8')
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { cwd: homedir(), windowsHide: true }
    )
  } else {
    // detached → 独立进程组,便于超时后整组 kill(命令可能派生子进程)。
    child = spawn('/bin/sh', ['-c', command], { cwd: homedir(), detached: true })
  }

  return new Promise<RunShellResult>((resolve, reject) => {
    let output = ''
    let killed = false
    let note: string | undefined
    const start = Date.now()
    let lastDataAt = start

    const append = (chunk: string): void => {
      output += chunk
      lastDataAt = Date.now()
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    const kill = (why: string): void => {
      if (killed) return
      killed = true
      note = why
      try {
        if (isWin && child.pid) {
          // /t 杀整棵进程树,避免残留孤儿进程(如 ping/长任务派生的子进程)。
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
        } else if (child.pid) {
          process.kill(-child.pid, 'SIGKILL')
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // 进程可能已退出
        }
      }
    }

    const watchdog = setInterval(() => {
      const now = Date.now()
      if (output.length > EXEC_MAX_OUTPUT) {
        kill(`输出超过 ${Math.round(EXEC_MAX_OUTPUT / 1024)}KB 上限,已终止(输出已截断)`)
      } else if (now - start >= EXEC_HARD_MS) {
        kill(`命令超过 ${EXEC_HARD_MS / 1000}s 硬上限,已终止`)
      } else if (now - lastDataAt >= EXEC_IDLE_MS) {
        kill(
          `命令静默超过 ${EXEC_IDLE_MS / 1000}s 无输出,已终止(若在等待输入,请改用非交互形式)`
        )
      }
    }, 500)

    child.on('error', (err) => {
      clearInterval(watchdog)
      reject(new Error(`本机 shell 启动失败: ${err.message}`))
    })

    child.on('close', (code) => {
      clearInterval(watchdog)
      if (killed) {
        resolve({ output, exitCode: null, timedOut: true, state: 'interrupted', note })
      } else {
        resolve({ output, exitCode: code, timedOut: false, state: 'completed' })
      }
    })
  })
}

export function registerLocalIpc(): void {
  ipcMain.handle('local:home', () => homedir())

  ipcMain.handle('local:exec', (_e, command: string) => runLocalShell(command))

  // 盘符探测必须异步 + 并行 + 超时:existsSync 是同步调用会阻塞主进程,
  // 断连/慢的网络映射盘一次探测能挂几十秒,导致整个应用所有窗口无响应。
  // 结果短缓存,反复打开 SFTP 面板不重复探测慢盘。
  let drivesCache: { at: number; drives: string[] } | null = null
  const DRIVES_CACHE_MS = 10_000
  const DRIVE_PROBE_TIMEOUT_MS = 1_000
  ipcMain.handle('local:drives', async (): Promise<string[]> => {
    if (process.platform !== 'win32') return ['/']
    if (drivesCache && Date.now() - drivesCache.at < DRIVES_CACHE_MS) return drivesCache.drives
    const checks: Promise<string | null>[] = []
    for (let c = 65; c <= 90; c++) {
      const root = `${String.fromCharCode(c)}:\\`
      checks.push(
        Promise.race([
          fsp.access(root).then(
            () => root,
            () => null
          ),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), DRIVE_PROBE_TIMEOUT_MS))
        ])
      )
    }
    const drives = (await Promise.all(checks)).filter((d): d is string => d !== null)
    drivesCache = { at: Date.now(), drives }
    return drives
  })

  ipcMain.handle('local:list', async (_e, dir: string): Promise<LocalListEntry[]> => {
    const dirents = await fsp.readdir(dir, { withFileTypes: true })
    // stat 并行执行(串行 await 在几千项的目录上就是几千次排队往返,肉眼可见地卡)。
    return Promise.all(
      dirents.map(async (d): Promise<LocalListEntry> => {
        const full = join(dir, d.name)
        try {
          const st = await fsp.stat(full)
          return {
            name: d.name,
            path: full,
            type: typeOf(st.isDirectory(), d.isSymbolicLink()),
            size: st.size,
            modifyTime: st.mtimeMs
          }
        } catch {
          // Unreadable entry (permissions, broken symlink) — surface name only.
          return {
            name: d.name,
            path: full,
            type: typeOf(d.isDirectory(), d.isSymbolicLink()),
            size: 0,
            modifyTime: 0
          }
        }
      })
    )
  })

  ipcMain.handle('local:stat', async (_e, p: string) => {
    const st = await fsp.stat(p)
    return {
      type: typeOf(st.isDirectory(), st.isSymbolicLink()),
      size: st.size,
      modifyTime: st.mtimeMs
    }
  })

  ipcMain.handle('local:mkdir', (_e, p: string) => fsp.mkdir(p, { recursive: true }).then(() => {}))

  ipcMain.handle('local:rename', (_e, oldPath: string, newPath: string) =>
    fsp.rename(oldPath, newPath)
  )

  ipcMain.handle('local:remove', (_e, p: string, isDirectory: boolean) =>
    isDirectory ? fsp.rm(p, { recursive: true, force: true }) : fsp.unlink(p)
  )

  ipcMain.handle('local:readFile', async (_e, p: string) => {
    const st = await fsp.stat(p)
    if (st.size > MAX_TEXT_BYTES) throw new Error('文件过大,无法在编辑器中打开(上限 2MB)')
    return fsp.readFile(p, 'utf8')
  })

  ipcMain.handle('local:writeFile', (_e, p: string, content: string) =>
    fsp.writeFile(p, content, 'utf8')
  )

  ipcMain.handle('local:readFileBase64', async (_e, p: string) => {
    const st = await fsp.stat(p)
    if (st.size > MAX_IMAGE_BYTES) throw new Error('图片过大,无法预览(上限 10MB)')
    const buf = await fsp.readFile(p)
    const mime = MIME_BY_EXT[extname(p).toLowerCase()] ?? 'application/octet-stream'
    return { base64: buf.toString('base64'), mime }
  })

  ipcMain.handle('local:copy', async (e, src: string, dstDir: string, transferId: string) => {
    await copyRecursive(src, dstDir, e.sender, transferId)
  })

  ipcMain.handle('local:pickDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Multi-select file picker for uploads; returns the chosen local paths ([] if cancelled).
  ipcMain.handle('local:pickFiles', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths
  })
}
