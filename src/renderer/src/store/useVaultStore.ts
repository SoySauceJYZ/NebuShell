import { create } from 'zustand'
import type { Host, Group, Credential, VaultImportResult } from '@shared/types'

interface VaultState {
  unlocked: boolean
  initialized: boolean
  hosts: Host[]
  groups: Group[]
  credentials: Credential[]
  checkStatus: () => Promise<void>
  createVault: (password: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  lock: () => Promise<void>
  refresh: () => Promise<void>

  addHost: (host: Omit<Host, 'id'>) => Promise<void>
  updateHost: (id: string, patch: Partial<Host>) => Promise<void>
  deleteHost: (id: string) => Promise<void>

  addGroup: (group: Omit<Group, 'id'>) => Promise<Group>
  updateGroup: (id: string, patch: Partial<Group>) => Promise<void>
  deleteGroup: (id: string) => Promise<void>

  addCredential: (cred: Omit<Credential, 'id'>) => Promise<void>
  updateCredential: (id: string, patch: Partial<Credential>) => Promise<void>
  deleteCredential: (id: string) => Promise<void>

  exportVault: (password: string) => Promise<string | null>
  importPickFile: () => Promise<string | null>
  importVault: (password: string, content: string) => Promise<VaultImportResult>
}

export const useVaultStore = create<VaultState>((set, get) => ({
  unlocked: false,
  initialized: false,
  hosts: [],
  groups: [],
  credentials: [],

  checkStatus: async () => {
    const initialized = await window.api.vault.isInitialized()
    const unlocked = await window.api.vault.isUnlocked()
    set({ initialized, unlocked })
    if (unlocked) await get().refresh()
  },

  createVault: async (password) => {
    const data = await window.api.vault.create(password)
    set({ initialized: true, unlocked: true, ...data })
  },

  unlock: async (password) => {
    const data = await window.api.vault.unlock(password)
    set({ unlocked: true, ...data })
  },

  lock: async () => {
    await window.api.vault.lock()
    set({ unlocked: false, hosts: [], groups: [], credentials: [] })
  },

  refresh: async () => {
    const data = await window.api.vault.getData()
    set({ hosts: data.hosts, groups: data.groups, credentials: data.credentials })
  },

  addHost: async (host) => {
    await window.api.vault.addHost(host)
    await get().refresh()
  },
  updateHost: async (id, patch) => {
    await window.api.vault.updateHost(id, patch)
    await get().refresh()
  },
  deleteHost: async (id) => {
    await window.api.vault.deleteHost(id)
    await get().refresh()
  },

  addGroup: async (group) => {
    const created = await window.api.vault.addGroup(group)
    await get().refresh()
    return created
  },
  updateGroup: async (id, patch) => {
    await window.api.vault.updateGroup(id, patch)
    await get().refresh()
  },
  deleteGroup: async (id) => {
    await window.api.vault.deleteGroup(id)
    await get().refresh()
  },

  addCredential: async (cred) => {
    await window.api.vault.addCredential(cred)
    await get().refresh()
  },
  updateCredential: async (id, patch) => {
    await window.api.vault.updateCredential(id, patch)
    await get().refresh()
  },
  deleteCredential: async (id) => {
    await window.api.vault.deleteCredential(id)
    await get().refresh()
  },

  exportVault: (password) => window.api.vault.exportData(password),
  importPickFile: () => window.api.vault.importPickFile(),
  importVault: async (password, content) => {
    const result = await window.api.vault.importApply(password, content)
    await get().refresh()
    return result
  }
}))
