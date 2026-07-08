import { ipcMain, app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import type { HistoryVersion, HistoryDocument } from '../../shared/types'

function historyRoot(): string {
  return join(app.getPath('userData'), 'sftp-history')
}

// fileKey is `${hostId}:${remotePath}`; hashed to a filesystem-safe directory name.
function dirForKey(fileKey: string): string {
  const hash = createHash('sha1').update(fileKey).digest('hex')
  return join(historyRoot(), hash)
}

function timestampName(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(
    d.getMinutes()
  )}-${p(d.getSeconds())}`
}

function labelFromId(id: string): string {
  const [date, time] = id.split('_')
  return time ? `${date} ${time.replace(/-/g, ':')}` : id
}

function parseKey(fileKey: string): { hostId: string; remotePath: string } {
  const idx = fileKey.indexOf(':')
  if (idx < 0) return { hostId: '', remotePath: fileKey }
  return { hostId: fileKey.slice(0, idx), remotePath: fileKey.slice(idx + 1) }
}

interface Meta {
  fileKey: string
  hostId: string
  remotePath: string
  fileName: string
}

export function registerHistoryIpc(): void {
  ipcMain.handle(
    'history:save',
    (_e, fileKey: string, content: string, fileName?: string): HistoryVersion => {
      const dir = dirForKey(fileKey)
      mkdirSync(dir, { recursive: true })
      let id = timestampName()
      if (existsSync(join(dir, `${id}.txt`))) id = `${id}-${Date.now() % 1000}`
      writeFileSync(join(dir, `${id}.txt`), content, 'utf8')

      const { hostId, remotePath } = parseKey(fileKey)
      const meta: Meta = {
        fileKey,
        hostId,
        remotePath,
        fileName: fileName || remotePath.split('/').pop() || remotePath
      }
      writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta), 'utf8')

      return { id, label: labelFromId(id), mtime: Date.now() }
    }
  )

  ipcMain.handle('history:list', (_e, fileKey: string): HistoryVersion[] => {
    const dir = dirForKey(fileKey)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => {
        const id = f.replace(/\.txt$/, '')
        return { id, label: labelFromId(id), mtime: statSync(join(dir, f)).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  })

  ipcMain.handle('history:read', (_e, fileKey: string, id: string): string => {
    const file = join(dirForKey(fileKey), `${id}.txt`)
    if (!existsSync(file)) throw new Error('历史版本不存在')
    return readFileSync(file, 'utf8')
  })

  ipcMain.handle('history:listAll', (): HistoryDocument[] => {
    const root = historyRoot()
    if (!existsSync(root)) return []
    const docs: HistoryDocument[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      const versions = readdirSync(dir).filter((f) => f.endsWith('.txt'))
      if (versions.length === 0) continue
      let meta: Meta | null = null
      const metaPath = join(dir, 'meta.json')
      if (existsSync(metaPath)) {
        try {
          meta = JSON.parse(readFileSync(metaPath, 'utf8'))
        } catch {
          meta = null
        }
      }
      const updatedAt = Math.max(...versions.map((f) => statSync(join(dir, f)).mtimeMs))
      docs.push({
        fileKey: meta?.fileKey ?? '',
        hostId: meta?.hostId ?? '',
        remotePath: meta?.remotePath ?? '',
        fileName: meta?.fileName ?? '(未知文件)',
        versionCount: versions.length,
        updatedAt
      })
    }
    return docs.sort((a, b) => b.updatedAt - a.updatedAt)
  })
}
