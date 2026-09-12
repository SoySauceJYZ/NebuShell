import { create } from 'zustand'
import type { ContainerInfo, ContainerStat, DockerProbeResult } from '../lib/dockerContainers'

/** 一台主机上 docker 的最新快照。由 lib/dockerPoll.ts 里的单一轮询器写入。 */
export interface HostDockerData {
  containers: ContainerInfo[] | null
  /** 按容器短 id 索引;未开启资源占用时为空对象。 */
  stats: Record<string, ContainerStat>
  error: string
  updatedAt: number
}

const EMPTY: HostDockerData = { containers: null, stats: {}, error: '', updatedAt: 0 }

// docker 探测结果 + 容器快照,都按 hostId 缓存并跨 tab 共享:同一台主机开再多终端,
// 也只有一份轮询和一份数据。终端重连或用户点「重新检测」时清除探测结果重新检测。
interface DockerState {
  probeByHost: Record<string, DockerProbeResult | undefined>
  setProbe: (hostId: string, r: DockerProbeResult) => void
  clearProbe: (hostId: string) => void

  dataByHost: Record<string, HostDockerData>
  setData: (hostId: string, patch: Partial<HostDockerData>) => void
  clearData: (hostId: string) => void

  /** 是否同时采集 docker stats(多花一条命令,默认开)。 */
  statsEnabled: boolean
  setStatsEnabled: (v: boolean) => void

  /** 每台主机上卷备份的落地目录(用户改过就记住,随进程存活)。 */
  backupDirByHost: Record<string, string>
  setBackupDir: (hostId: string, dir: string) => void
}

export const useDockerStore = create<DockerState>((set) => ({
  probeByHost: {},
  setProbe: (hostId, r) => set((s) => ({ probeByHost: { ...s.probeByHost, [hostId]: r } })),
  clearProbe: (hostId) =>
    set((s) => {
      const next = { ...s.probeByHost }
      delete next[hostId]
      return { probeByHost: next }
    }),

  dataByHost: {},
  setData: (hostId, patch) =>
    set((s) => ({
      dataByHost: {
        ...s.dataByHost,
        [hostId]: { ...(s.dataByHost[hostId] ?? EMPTY), ...patch, updatedAt: Date.now() }
      }
    })),
  clearData: (hostId) =>
    set((s) => {
      const next = { ...s.dataByHost }
      delete next[hostId]
      return { dataByHost: next }
    }),

  statsEnabled: true,
  setStatsEnabled: (v) => set({ statsEnabled: v }),

  backupDirByHost: {},
  setBackupDir: (hostId, dir) =>
    set((s) => ({ backupDirByHost: { ...s.backupDirByHost, [hostId]: dir } }))
}))

export const emptyHostData = EMPTY
