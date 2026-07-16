import { useState } from 'react'
import { useTransfersStore } from '../store/useTransfersStore'
import { baseName } from './pathUtils'

const MIME = 'application/x-nebushell'

export type PaneKind = 'remote' | 'local' | 'container'

export interface DragPayload {
  sourceKind: PaneKind
  sessionId?: string
  hostId?: string
  path: string
  name: string
  isDirectory: boolean
}

/** Identity + destination info for a pane acting as a drag source and drop target. */
export interface PaneDndContext {
  kind: PaneKind
  sessionId?: string
  hostId?: string
  /** The tab/window that owns transfers initiated here (for the records panel). */
  ownerId: string
  /** Current directory of this pane — the drop destination. */
  dir: string
  /** Reload this pane's listing after a transfer completes into it. */
  refresh: () => void
  /** Surface a non-transfer message (e.g. unsupported drop route) in the pane. */
  notify?: (msg: string) => void
}

interface DropEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
}

export interface FileDnd {
  isDragOver: boolean
  dropZoneProps: {
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
  getRowDragProps: (entry: DropEntry) => {
    draggable: true
    onDragStart: (e: React.DragEvent) => void
  }
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useFileDnd(ctx: PaneDndContext): FileDnd {
  const [isDragOver, setDragOver] = useState(false)
  const track = useTransfersStore((s) => s.track)

  const runTransfer = async (
    label: string,
    run: (transferId: string) => Promise<void>
  ): Promise<void> => {
    const transferId = genId()
    track(transferId, label, ctx.ownerId)
    try {
      await run(transferId)
    } catch {
      // Progress stream already surfaced the error to the transfers overlay.
    } finally {
      ctx.refresh()
    }
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)

    // 1) OS / Explorer file drop.
    if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.api.os.getPathForFile(f))
        .filter(Boolean)
      if (paths.length === 0) return
      const label = `${ctx.kind === 'local' ? '复制' : '上传'} ${
        paths.length === 1 ? baseName(paths[0]) : `${paths.length} 项`
      }`
      void runTransfer(label, async (transferId) => {
        if (ctx.kind === 'remote' && ctx.sessionId) {
          await window.api.sftp.uploadPaths(ctx.sessionId, ctx.dir, paths, transferId)
        } else if (ctx.kind === 'container' && ctx.sessionId) {
          await window.api.containerFs.uploadPaths(ctx.sessionId, ctx.dir, paths, transferId)
        } else {
          for (const p of paths) await window.api.local.copy(p, ctx.dir, transferId)
        }
      })
      return
    }

    // 2) Inter-pane drag (custom payload).
    const raw = e.dataTransfer.getData(MIME)
    if (!raw) return
    let src: DragPayload
    try {
      src = JSON.parse(raw)
    } catch {
      return
    }
    // Ignore a drop onto the exact same pane+dir the item already lives in.
    if (src.sourceKind === ctx.kind && src.sessionId === ctx.sessionId) {
      const srcDir = src.path.replace(/[\\/][^\\/]+[\\/]?$/, '') || '/'
      if (srcDir === ctx.dir.replace(/[\\/]+$/, '') || srcDir === ctx.dir) return
    }

    // 容器面板仅支持与本地互传;容器↔远程 / 容器↔容器 需经本地中转(v1 不做流式桥接)。
    if (
      (src.sourceKind === 'container' || ctx.kind === 'container') &&
      !(src.sourceKind === 'container' && ctx.kind === 'local') &&
      !(src.sourceKind === 'local' && ctx.kind === 'container')
    ) {
      ctx.notify?.('暂不支持容器与远程主机面板之间直接传输,请经由本地面板中转')
      return
    }

    const verb =
      (src.sourceKind === 'remote' || src.sourceKind === 'container') && ctx.kind === 'local'
        ? '下载'
        : src.sourceKind === 'local' && (ctx.kind === 'remote' || ctx.kind === 'container')
          ? '上传'
          : '复制'
    void runTransfer(`${verb} ${src.name}`, async (transferId) => {
      if (src.sourceKind === 'remote' && ctx.kind === 'remote') {
        await window.api.sftp.transfer(
          src.sessionId!,
          src.path,
          ctx.sessionId!,
          ctx.dir,
          transferId
        )
      } else if (src.sourceKind === 'local' && ctx.kind === 'remote') {
        await window.api.sftp.uploadPaths(ctx.sessionId!, ctx.dir, [src.path], transferId)
      } else if (src.sourceKind === 'remote' && ctx.kind === 'local') {
        await window.api.sftp.downloadTo(src.sessionId!, src.path, ctx.dir, transferId)
      } else if (src.sourceKind === 'local' && ctx.kind === 'container') {
        await window.api.containerFs.uploadPaths(ctx.sessionId!, ctx.dir, [src.path], transferId)
      } else if (src.sourceKind === 'container' && ctx.kind === 'local') {
        await window.api.containerFs.downloadTo(src.sessionId!, src.path, ctx.dir, transferId)
      } else {
        await window.api.local.copy(src.path, ctx.dir, transferId)
      }
    })
  }

  return {
    isDragOver,
    dropZoneProps: {
      onDragOver: (e) => {
        if (e.dataTransfer.types.includes(MIME) || e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!isDragOver) setDragOver(true)
        }
      },
      onDragLeave: (e) => {
        // Only clear when leaving the pane subtree, not when moving between rows.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      },
      onDrop
    },
    getRowDragProps: (entry) => ({
      draggable: true,
      onDragStart: (e) => {
        const payload: DragPayload = {
          sourceKind: ctx.kind,
          sessionId: ctx.sessionId,
          hostId: ctx.hostId,
          path: entry.path,
          name: entry.name,
          isDirectory: entry.type === 'directory'
        }
        e.dataTransfer.setData(MIME, JSON.stringify(payload))
        e.dataTransfer.setData('text/plain', entry.name)
        e.dataTransfer.effectAllowed = 'copyMove'
      }
    })
  }
}
