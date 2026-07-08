import { create } from 'zustand'
import type { TransferProgress } from '@shared/types'

export interface TransferItem {
  id: string
  label: string
  phase: TransferProgress['phase']
  currentPath?: string
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
  error?: string
}

interface TransfersState {
  items: TransferItem[]
  /** Register a transfer and start listening for its progress events. */
  track: (id: string, label: string) => void
  remove: (id: string) => void
}

// Unsubscribe handles kept outside the store (not serializable React state).
const unsubs = new Map<string, () => void>()
const removeTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useTransfersStore = create<TransfersState>((set, get) => ({
  items: [],

  track: (id, label) => {
    set((s) => ({
      items: [
        ...s.items.filter((i) => i.id !== id),
        {
          id,
          label,
          phase: 'scan',
          doneBytes: 0,
          totalBytes: 0,
          doneFiles: 0,
          totalFiles: 0
        }
      ]
    }))

    const unsub = window.api.transfers.onProgress(id, (p) => {
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
                error: p.error
              }
            : i
        )
      }))
      if (p.phase === 'done' || p.phase === 'error') {
        unsubs.get(id)?.()
        unsubs.delete(id)
        // Keep the finished row visible briefly, then drop it.
        const timer = setTimeout(() => get().remove(id), p.phase === 'error' ? 8000 : 3000)
        removeTimers.set(id, timer)
      }
    })
    unsubs.set(id, unsub)
  },

  remove: (id) => {
    unsubs.get(id)?.()
    unsubs.delete(id)
    const t = removeTimers.get(id)
    if (t) {
      clearTimeout(t)
      removeTimers.delete(id)
    }
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  }
}))
