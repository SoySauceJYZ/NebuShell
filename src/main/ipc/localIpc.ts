import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { promises as fsp, createReadStream, createWriteStream, existsSync } from 'fs'
import { homedir } from 'os'
import { basename, join, extname } from 'path'
import type { LocalListEntry, TransferProgress } from '../../shared/types'

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

export function registerLocalIpc(): void {
  ipcMain.handle('local:home', () => homedir())

  ipcMain.handle('local:drives', () => {
    if (process.platform !== 'win32') return ['/']
    const drives: string[] = []
    for (let c = 65; c <= 90; c++) {
      const root = `${String.fromCharCode(c)}:\\`
      if (existsSync(root)) drives.push(root)
    }
    return drives
  })

  ipcMain.handle('local:list', async (_e, dir: string): Promise<LocalListEntry[]> => {
    const dirents = await fsp.readdir(dir, { withFileTypes: true })
    const entries: LocalListEntry[] = []
    for (const d of dirents) {
      const full = join(dir, d.name)
      try {
        const st = await fsp.stat(full)
        entries.push({
          name: d.name,
          path: full,
          type: typeOf(st.isDirectory(), d.isSymbolicLink()),
          size: st.size,
          modifyTime: st.mtimeMs
        })
      } catch {
        // Unreadable entry (permissions, broken symlink) — surface name only.
        entries.push({
          name: d.name,
          path: full,
          type: typeOf(d.isDirectory(), d.isSymbolicLink()),
          size: 0,
          modifyTime: 0
        })
      }
    }
    return entries
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
