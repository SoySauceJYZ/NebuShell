import { create } from 'zustand'
import type { UpdateInfo } from '@shared/types'

interface UpdateStore {
  /** 最近一次检查的结果,未检查过为 null。 */
  info: UpdateInfo | null
  checking: boolean
  error: string
  /** 用户已经在设置页看过这条新版本提示(看过后侧边栏不再显示红点)。 */
  seen: boolean
  /** 拉取主进程里本次运行已缓存的结果(启动时/打开设置页用)。 */
  hydrate: () => Promise<void>
  /** 手动检查更新。 */
  check: () => Promise<void>
  /** 启动时自动检查发现新版本。 */
  receive: (info: UpdateInfo) => void
  markSeen: () => void
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  info: null,
  checking: false,
  error: '',
  seen: false,

  hydrate: async () => {
    const info = await window.api.update.getCached()
    // 手动检查正在进行时不要用旧缓存盖掉即将到来的新结果。
    if (info && !get().checking) set({ info })
  },

  check: async () => {
    set({ checking: true, error: '' })
    try {
      const info = await window.api.update.check()
      set({ info, checking: false, seen: true })
    } catch (err) {
      set({ checking: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  receive: (info) => set({ info, seen: false }),

  markSeen: () => set({ seen: true })
}))
