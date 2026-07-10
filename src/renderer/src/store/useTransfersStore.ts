import { create } from 'zustand'
import type { TransferProgress } from '@shared/types'

export interface TransferItem {
  id: string
  /** The tab/window this transfer belongs to; scopes the records panel + close prompt. */
  ownerId: string
  label: string
  phase: TransferProgress['phase']
  currentPath?: string
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
  /** Smoothed transfer speed in bytes/sec; 0 when unknown (scanning / just started). */
  speed: number
  error?: string
  startedAt: number
  endedAt?: number
}

/** A transfer still counts as running while it is scanning or transferring. */
export function isActivePhase(phase: TransferProgress['phase']): boolean {
  return phase === 'scan' || phase === 'transfer'
}

// Keep memory bounded: cap retained records per window (oldest finished dropped first).
const MAX_RECORDS_PER_OWNER = 100

interface TransfersState {
  items: TransferItem[]
  /** Per-window collapse state for the records panel (undefined = expanded). */
  collapsed: Record<string, boolean>
  /** Register a transfer under a window and start listening for its progress events. */
  track: (id: string, label: string, ownerId: string) => void
  remove: (id: string) => void
  /** Drop finished (done/error) records for a window, keeping any still running. */
  clearFinished: (ownerId: string) => void
  /** Drop all records for a window (used when the window/tab closes). */
  clearOwner: (ownerId: string) => void
  setCollapsed: (ownerId: string, collapsed: boolean) => void
  /** Whether a window has at least one still-running transfer. */
  hasActive: (ownerId: string) => boolean
}

// Unsubscribe handles kept outside the store (not serializable React state).
const unsubs = new Map<string, () => void>()
// Last sampled point per transfer, used to derive an instantaneous speed.
const speedSamples = new Map<string, { time: number; bytes: number }>()

/**
 * Derive a smoothed bytes/sec figure from consecutive progress events.
 * Uses an exponential moving average so the readout stays stable despite
 * the ~100ms throttled, bursty progress stream.
 */
function computeSpeed(id: string, p: TransferProgress, prevSpeed: number): number {
  if (p.phase !== 'transfer') return 0
  const now = Date.now()
  const prev = speedSamples.get(id)
  if (!prev) {
    speedSamples.set(id, { time: now, bytes: p.doneBytes })
    return prevSpeed
  }
  const dt = (now - prev.time) / 1000
  const db = p.doneBytes - prev.bytes
  // Ignore too-close or non-advancing samples to avoid divide-by-zero spikes.
  if (dt < 0.15 || db < 0) return prevSpeed
  speedSamples.set(id, { time: now, bytes: p.doneBytes })
  const instant = db / dt
  return prevSpeed > 0 ? prevSpeed * 0.6 + instant * 0.4 : instant
}

export const useTransfersStore = create<TransfersState>((set, get) => ({
  items: [],
  collapsed: {},

  track: (id, label, ownerId) => {
    set((s) => {
      const withoutDup = s.items.filter((i) => i.id !== id)
      const next: TransferItem = {
        id,
        ownerId,
        label,
        phase: 'scan',
        doneBytes: 0,
        totalBytes: 0,
        doneFiles: 0,
        totalFiles: 0,
        speed: 0,
        startedAt: Date.now()
      }
      return { items: capOwner([...withoutDup, next], ownerId) }
    })

    const unsub = window.api.transfers.onProgress(id, (p) => {
      const prevSpeed = get().items.find((i) => i.id === id)?.speed ?? 0
      const speed = computeSpeed(id, p, prevSpeed)
      const finished = p.phase === 'done' || p.phase === 'error'
      set((s) => ({
        items: s.items.map((i) =>
          i.id === id
            ? {
                ...i,
                phase: p.phase,
                currentPath: p.currentPath,
                doneBytes: p.doneBytes,
                totalBytes: p.totalBytes,
                doneFiles: p.doneFiles,
                totalFiles: p.totalFiles,
                speed,
                error: p.error,
                endedAt: finished ? (i.endedAt ?? Date.now()) : i.endedAt
              }
            : i
        )
      }))
      if (finished) {
        // Stop listening but KEEP the record as history until the user clears it.
        unsubs.get(id)?.()
        unsubs.delete(id)
        speedSamples.delete(id)
      }
    })
    unsubs.set(id, unsub)
  },

  remove: (id) => {
    unsubs.get(id)?.()
    unsubs.delete(id)
    speedSamples.delete(id)
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  },

  clearFinished: (ownerId) => {
    set((s) => ({
      items: s.items.filter((i) => i.ownerId !== ownerId || isActivePhase(i.phase))
    }))
  },

  clearOwner: (ownerId) => {
    for (const i of get().items) {
      if (i.ownerId === ownerId) {
        unsubs.get(i.id)?.()
        unsubs.delete(i.id)
        speedSamples.delete(i.id)
      }
    }
    set((s) => ({ items: s.items.filter((i) => i.ownerId !== ownerId) }))
  },

  setCollapsed: (ownerId, collapsed) =>
    set((s) => ({ collapsed: { ...s.collapsed, [ownerId]: collapsed } })),

  hasActive: (ownerId) => get().items.some((i) => i.ownerId === ownerId && isActivePhase(i.phase))
}))

/** Trim retained records for a window to the cap, dropping oldest finished first. */
function capOwner(items: TransferItem[], ownerId: string): TransferItem[] {
  const owned = items.filter((i) => i.ownerId === ownerId)
  if (owned.length <= MAX_RECORDS_PER_OWNER) return items
  const finished = owned
    .filter((i) => !isActivePhase(i.phase))
    .sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt))
  const dropCount = owned.length - MAX_RECORDS_PER_OWNER
  const dropIds = new Set(finished.slice(0, dropCount).map((i) => i.id))
  for (const id of dropIds) {
    unsubs.get(id)?.()
    unsubs.delete(id)
    speedSamples.delete(id)
  }
  return items.filter((i) => !dropIds.has(i.id))
}
