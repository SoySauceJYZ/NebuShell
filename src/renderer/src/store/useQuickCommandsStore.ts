import { create } from 'zustand'
import type { QuickCommand } from '@shared/types'

// Stable empty reference so zustand selectors don't return a fresh array each render.
export const EMPTY_QUICK_COMMANDS: QuickCommand[] = []

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface QuickCommandsStore {
  items: QuickCommand[]
  hydrated: boolean
  /** Load persisted commands once (subsequent calls are no-ops). */
  hydrate: () => Promise<void>
  add: (input: Omit<QuickCommand, 'id' | 'createdAt'>) => void
  update: (id: string, patch: Partial<Omit<QuickCommand, 'id' | 'createdAt'>>) => void
  remove: (id: string) => void
}

// Persist the whole array on every mutation (the list is small; matches the settings-style
// whole-object write). Fire-and-forget: in-memory state is the source of truth for the UI.
function persist(items: QuickCommand[]): void {
  void window.api.quickCommands.save(items)
}

export const useQuickCommandsStore = create<QuickCommandsStore>((set, get) => ({
  items: EMPTY_QUICK_COMMANDS,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    const items = await window.api.quickCommands.list()
    set({ items, hydrated: true })
  },

  add: (input) => {
    const item: QuickCommand = { ...input, id: genId(), createdAt: Date.now() }
    const items = [...get().items, item]
    set({ items })
    persist(items)
  },

  update: (id, patch) => {
    const items = get().items.map((it) => (it.id === id ? { ...it, ...patch } : it))
    set({ items })
    persist(items)
  },

  remove: (id) => {
    const items = get().items.filter((it) => it.id !== id)
    set({ items })
    persist(items)
  }
}))
