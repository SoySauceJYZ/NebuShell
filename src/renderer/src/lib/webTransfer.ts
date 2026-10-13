import { progressToast, triggerDownload } from './webDialogs'

// Web edition: moving files between the browser's computer and the server. The server
// side stages them in a temp directory (src/web/server/transfer.ts), so the existing
// `uploadPaths` / `downloadTo` / `local:copy` calls run unchanged with server paths:
//  - uploads: files picked or dropped in the browser are POSTed into a staging dir and
//    the caller gets server paths back; once every path has been consumed by a transfer
//    the staging dir is released;
//  - downloads: a staging dir stands in for the "local folder" picked on desktop, and
//    whatever lands in it is handed to the browser's download manager.

interface Staging {
  id: string
  path: string
}

async function alloc(): Promise<Staging> {
  const res = await fetch('/api/transfer/alloc', { method: 'POST' })
  if (!res.ok) throw new Error(`无法分配传输目录 (${res.status})`)
  return (await res.json()) as Staging
}

function uploadOne(id: string, file: File, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const q = new URLSearchParams({ id, name: file.name })
    xhr.open('POST', `/api/transfer/upload?${q}`)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      if (xhr.status === 200) resolve((JSON.parse(xhr.responseText) as { path: string }).path)
      else reject(new Error(`上传 ${file.name} 失败 (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error(`上传 ${file.name} 失败`))
    xhr.send(file)
  })
}

// Server paths of uploaded files → their staging id, with how many are still unused.
const pathToStaging = new Map<string, string>()
const pendingCount = new Map<string, number>()

/** Upload browser files to the server; returns their server-side paths. */
export async function uploadToServer(files: File[]): Promise<string[]> {
  if (files.length === 0) return []
  const staging = await alloc()
  const total = files.reduce((n, f) => n + f.size, 0) || 1
  const toast = progressToast(
    files.length === 1 ? `上传到服务器:${files[0].name}` : `上传到服务器:${files.length} 个文件`
  )
  const paths: string[] = []
  let done = 0
  try {
    for (const file of files) {
      paths.push(
        await uploadOne(staging.id, file, (loaded) => toast.update((done + loaded) / total))
      )
      done += file.size
    }
  } catch (err) {
    void release(staging.id)
    throw err
  } finally {
    toast.close()
  }
  for (const p of paths) pathToStaging.set(p, staging.id)
  pendingCount.set(staging.id, paths.length)
  return paths
}

async function release(id: string): Promise<void> {
  pendingCount.delete(id)
  await fetch(`/api/transfer/release?${new URLSearchParams({ id })}`, { method: 'POST' }).catch(
    () => undefined
  )
}

/** A transfer that read these server paths has finished; drop staging dirs nobody needs. */
export function consumeUploadedPaths(paths: string[]): void {
  for (const p of paths) {
    const id = pathToStaging.get(p)
    if (!id) continue
    pathToStaging.delete(p)
    const left = (pendingCount.get(id) ?? 1) - 1
    if (left <= 0) void release(id)
    else pendingCount.set(id, left)
  }
}

// Staging dirs handed out as download targets: server path → staging id.
const downloadDirs = new Map<string, string>()

/** Stand-in for "pick a local folder" when downloading: a fresh staging dir. */
export async function allocDownloadDir(): Promise<string> {
  const staging = await alloc()
  downloadDirs.set(staging.path, staging.id)
  return staging.path
}

/**
 * Called after a `downloadTo` finished: if its target was a browser download dir, fetch
 * what arrived there (`<dir>/<basename(remotePath)>`) through the browser.
 */
export function deliverDownload(localDir: string, remotePath: string): void {
  const id = downloadDirs.get(localDir)
  if (!id) return
  const name = remotePath.replace(/\/+$/, '').split('/').pop() || 'download'
  triggerDownload(`/api/transfer/fetch?${new URLSearchParams({ id, name })}`)
}
