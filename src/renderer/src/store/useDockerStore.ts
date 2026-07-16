import { create } from 'zustand'
import type { DockerProbeResult } from '../lib/dockerContainers'

// docker 探测结果缓存(hostId → 可用前缀/不可用原因)。
// 终端重连或用户点「重新检测」时清除,重新探测。
interface DockerState {
  probeByHost: Record<string, DockerProbeResult | undefined>
  setProbe: (hostId: string, r: DockerProbeResult) => void
  clearProbe: (hostId: string) => void
}

export const useDockerStore = create<DockerState>((set) => ({
  probeByHost: {},
  setProbe: (hostId, r) =>
    set((state) => ({ probeByHost: { ...state.probeByHost, [hostId]: r } })),
  clearProbe: (hostId) =>
    set((state) => {
      const next = { ...state.probeByHost }
      delete next[hostId]
      return { probeByHost: next }
    })
}))
