import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  RefreshCw,
  Search,
  X,
  Activity,
  ChevronRight,
  ChevronDown,
  Layers3,
  MoreHorizontal,
  Play,
  Square,
  RotateCw
} from 'lucide-react'
import { mapDockerError } from '@shared/dockerErrors'
import { useDockerStore, emptyHostData } from '../store/useDockerStore'
import { useSessionStore } from '../store/useSessionStore'
import { useVaultStore } from '../store/useVaultStore'
import { subscribe, setVisible, refreshNow } from '../lib/dockerPoll'
import {
  PROBE_COMMAND,
  parseProbeOutput,
  buildContainerActionCommand,
  buildInspectCommand,
  logTarget,
  CONTAINER_VERB_LABEL,
  type ContainerInfo,
  type ContainerVerb,
  type ExecShellOptions
} from '../lib/dockerContainers'
import { ContainerCard } from './docker/ContainerCard'
import { ExecOptionsModal } from './docker/ExecOptionsModal'
import { MountsModal } from './docker/MountsModal'
import {
  ImagesSection,
  VolumesSection,
  NetworksSection,
  PruneSection
} from './docker/ResourcesSection'
import type { DockerCtx } from './docker/ctx'

type Section = 'containers' | 'images' | 'volumes' | 'networks' | 'prune'

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'containers', label: '容器' },
  { id: 'images', label: '镜像' },
  { id: 'volumes', label: '卷' },
  { id: 'networks', label: '网络' },
  { id: 'prune', label: '清理' }
]

/** 新 tab 的唯一 id。放在组件外,免得组件体内直接调用 Date.now(渲染纯度告警)。 */
function tabId(prefix: string): string {
  return `${prefix}-${Date.now()}`
}

/** 需要确认的动作:影响面大或不可逆。 */
const NEEDS_CONFIRM: Partial<Record<ContainerVerb, string>> = {
  kill: '直接发送 SIGKILL,容器内进程没有机会优雅退出。',
  rm: '删除后容器本身不可恢复(镜像和卷不受影响)。',
  rmForce: '容器仍在运行,将先强制停止再删除。'
}

export function DockerPanel({
  sessionId,
  hostId,
  connected
}: {
  sessionId: string
  hostId: string
  connected: boolean
}): React.ReactElement {
  const probe = useDockerStore((s) => s.probeByHost[hostId])
  const setProbe = useDockerStore((s) => s.setProbe)
  const clearProbe = useDockerStore((s) => s.clearProbe)
  const data = useDockerStore((s) => s.dataByHost[hostId]) ?? emptyHostData
  const statsEnabled = useDockerStore((s) => s.statsEnabled)
  const setStatsEnabled = useDockerStore((s) => s.setStatsEnabled)
  const setData = useDockerStore((s) => s.setData)
  const openTab = useSessionStore((s) => s.openTab)
  const host = useVaultStore((s) => s.hosts.find((h) => h.id === hostId))
  const hostLabel = host?.label ?? '主机'

  const dockerCmd = probe === 'docker' || probe === 'sudo -n docker' ? probe : null
  const [section, setSection] = useState<Section>('containers')
  const [query, setQuery] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [execFor, setExecFor] = useState<ContainerInfo | null>(null)
  const [mountsFor, setMountsFor] = useState<ContainerInfo | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // 重连(connected false→true)时清除探测缓存,重新检测(sudo 情况可能已变化)。
  const prevConnected = useRef(connected)
  useEffect(() => {
    if (connected && !prevConnected.current) clearProbe(hostId)
    prevConnected.current = connected
  }, [connected, hostId, clearProbe])

  // 探测(结果按 hostId 缓存,跨 tab 共享)
  useEffect(() => {
    if (!connected || probe) return
    let cancelled = false
    window.api.ssh
      .execFull(sessionId, PROBE_COMMAND)
      .then((res) => {
        if (!cancelled) setProbe(hostId, parseProbeOutput(res.stdout))
      })
      .catch((e) => {
        if (!cancelled) setActionError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [connected, probe, sessionId, hostId, setProbe])

  // 容器列表由 lib/dockerPoll 的**单一轮询器**驱动:同一台主机的多个面板共用一份。
  useEffect(() => {
    if (!connected || !dockerCmd) return
    return subscribe(hostId, sessionId, sessionId, dockerCmd)
  }, [connected, dockerCmd, hostId, sessionId])

  // 面板是否真的被看见:tab 切走时整棵子树是 display:none,IntersectionObserver 会
  // 报告不可见,轮询随之暂停;切回来立刻补一轮。
  useEffect(() => {
    const el = rootRef.current
    if (!el || !connected || !dockerCmd) return
    const io = new IntersectionObserver(
      (entries) =>
        setVisible(
          hostId,
          sessionId,
          entries.some((e) => e.isIntersecting)
        ),
      { threshold: 0 }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      setVisible(hostId, sessionId, false)
    }
  }, [connected, dockerCmd, hostId, sessionId])

  const run = useCallback(
    async (command: string): Promise<boolean> => {
      setBusy(true)
      try {
        const res = await window.api.ssh.execFull(sessionId, command)
        if (res.code !== 0) {
          setActionError(mapDockerError(res.stderr || res.stdout))
          return false
        }
        setActionError('')
        return true
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setBusy(false)
        refreshNow(hostId)
      }
    },
    [sessionId, hostId]
  )

  const runQuery = useCallback(
    async (command: string): Promise<string | null> => {
      setBusy(true)
      try {
        const res = await window.api.ssh.execFull(sessionId, command)
        if (res.code !== 0) {
          setActionError(mapDockerError(res.stderr || res.stdout))
          return null
        }
        setActionError('')
        return res.stdout
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        setBusy(false)
      }
    },
    [sessionId]
  )

  const ctx: DockerCtx = useMemo(
    () => ({
      sessionId,
      hostId,
      dockerCmd: dockerCmd ?? 'docker',
      hostLabel,
      hostAddress: host?.address ?? 'localhost',
      run,
      query: runQuery,
      refresh: () => refreshNow(hostId),
      busy
    }),
    [sessionId, hostId, dockerCmd, hostLabel, host?.address, run, runQuery, busy]
  )

  // ---- 打开各种 tab --------------------------------------------------------

  const openTerminal = (c: ContainerInfo, opts: ExecShellOptions = {}): void => {
    openTab({
      id: tabId(`terminal-${hostId}`),
      kind: 'terminal',
      title: `${c.name} @ ${hostLabel}`,
      hostId,
      containerId: c.id,
      containerName: c.name,
      dockerCmd: ctx.dockerCmd,
      containerUser: opts.user,
      containerWorkdir: opts.workdir,
      containerShell: opts.shell
    })
  }

  const openFiles = (c: ContainerInfo): void => {
    openTab({
      id: tabId(`explorer-cfs-${c.id.slice(0, 12)}`),
      kind: 'explorer',
      title: `${c.name} (文件)`,
      hostId,
      explorerContainerId: c.id,
      explorerContainerName: c.name,
      dockerCmd: ctx.dockerCmd
    })
  }

  // 日志跟随:单独开一个标签页跑 docker logs -f,不再占用你正在用的终端。
  const openLogsFollow = (c: ContainerInfo): void => {
    openTab({
      id: tabId(`terminal-logs-${c.id.slice(0, 12)}`),
      kind: 'terminal',
      title: `${c.name} (日志)`,
      hostId,
      containerId: c.id,
      containerName: logTarget(c),
      dockerCmd: ctx.dockerCmd,
      containerLogsFollow: true,
      containerLogsTail: 200
    })
  }

  const openLogsEditor = (c: ContainerInfo): void => {
    openTab({
      id: tabId(`editor-logs-${c.id.slice(0, 12)}`),
      kind: 'editor',
      title: `${c.name} (日志)`,
      editorSourceSessionId: sessionId,
      editorLogTarget: logTarget(c),
      editorLogDockerCmd: ctx.dockerCmd,
      editorLang: 'log',
      editorReadOnly: true
    })
  }

  const openInspect = (c: ContainerInfo): void => {
    openTab({
      id: tabId(`editor-inspect-${c.id.slice(0, 12)}`),
      kind: 'editor',
      title: `${c.name} (详情)`,
      editorExecCommand: buildInspectCommand(ctx.dockerCmd, c.id),
      editorSourceSessionId: sessionId,
      editorLang: 'json',
      editorReadOnly: true
    })
  }

  /** 在宿主机的文件浏览器里打开某个目录(卷 / 绑定挂载)。 */
  const openHostPath = (path: string): void => {
    openTab({
      id: tabId(`explorer-${hostId}`),
      kind: 'explorer',
      title: `${hostLabel} (SFTP)`,
      hostId,
      explorerInitialPath: path
    })
  }

  // ---- 容器动作 ------------------------------------------------------------

  const runVerb = async (c: ContainerInfo, verb: ContainerVerb): Promise<void> => {
    const detail = NEEDS_CONFIRM[verb]
    if (detail) {
      const ok = await window.api.dialog.confirm({
        message: `${CONTAINER_VERB_LABEL[verb]}容器 “${c.name}”?`,
        detail,
        confirmLabel: CONTAINER_VERB_LABEL[verb],
        cancelLabel: '取消'
      })
      if (!ok) return
    }
    await run(buildContainerActionCommand(ctx.dockerCmd, verb, c.id))
  }

  /** compose 项目整组操作:docker 本身支持一条命令带多个容器 id。 */
  const runGroup = async (
    project: string,
    list: ContainerInfo[],
    verb: 'start' | 'stop' | 'restart'
  ): Promise<void> => {
    if (verb !== 'start') {
      const ok = await window.api.dialog.confirm({
        message: `${CONTAINER_VERB_LABEL[verb]}项目 “${project}” 的全部 ${list.length} 个容器?`,
        detail: list.map((c) => c.name).join('、'),
        confirmLabel: CONTAINER_VERB_LABEL[verb],
        cancelLabel: '取消'
      })
      if (!ok) return
    }
    await run(`${ctx.dockerCmd} ${verb} ${list.map((c) => c.id).join(' ')}`)
  }

  // ---- 分组与过滤 ----------------------------------------------------------

  const q = query.trim().toLowerCase()
  const matched = (data.containers ?? []).filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.image.toLowerCase().includes(q) ||
      (c.project ?? '').toLowerCase().includes(q)
  )
  const groups = new Map<string, ContainerInfo[]>()
  const loose: ContainerInfo[] = []
  for (const c of matched) {
    if (c.project) {
      const arr = groups.get(c.project)
      if (arr) arr.push(c)
      else groups.set(c.project, [c])
    } else {
      loose.push(c)
    }
  }

  const cardFor = (c: ContainerInfo): React.ReactElement => (
    <ContainerCard
      key={c.id}
      c={c}
      stat={data.stats[c.id.slice(0, 12)]}
      ctx={ctx}
      busy={busy}
      actions={{
        onAction: (verb) => void runVerb(c, verb),
        onTerminal: (opts) => openTerminal(c, opts ?? {}),
        onCustomTerminal: () => setExecFor(c),
        onFiles: () => openFiles(c),
        onLogsFollow: () => openLogsFollow(c),
        onLogsEditor: () => openLogsEditor(c),
        onMounts: () => setMountsFor(c),
        onInspect: () => openInspect(c)
      }}
    />
  )

  const showFilter = section !== 'prune'

  return (
    <div ref={rootRef} className="relative flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-4">
        <span className="text-sm font-semibold text-[var(--text-dark)]">容器</span>
        {dockerCmd && (
          <span className="flex items-center gap-2">
            {probe === 'sudo -n docker' && (
              <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                sudo
              </span>
            )}
            <button
              onClick={() => {
                // 关掉时顺手清空已有数字(否则要等下一轮轮询才消失)。
                if (statsEnabled) setData(hostId, { stats: {} })
                setStatsEnabled(!statsEnabled)
              }}
              title={
                statsEnabled ? '关闭资源占用采集(docker stats)' : '开启资源占用采集(docker stats)'
              }
              className={`rounded p-1 hover:bg-[var(--nav-bg-hover)] ${
                statsEnabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
              }`}
            >
              <Activity size={13} />
            </button>
            <button
              onClick={() => refreshNow(hostId)}
              title="刷新"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
            >
              <RefreshCw size={13} />
            </button>
          </span>
        )}
      </div>

      {dockerCmd && (
        <div className="flex shrink-0 gap-1 border-b border-[var(--panel-border)] px-3 py-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`rounded-md px-2 py-1 text-xs ${
                section === s.id
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {dockerCmd && showFilter && (
        <div className="shrink-0 border-b border-[var(--panel-border)] px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--content-bg)] px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={section === 'containers' ? '搜索容器名 / 镜像 / 项目' : '搜索名称'}
              className="w-full min-w-0 bg-transparent text-xs text-[var(--text-dark)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                title="清除"
                className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!connected && <div className="text-xs text-[var(--text-muted)]">未连接</div>}
        {connected && !probe && (
          <div className="text-xs text-[var(--text-muted)]">正在检测 Docker...</div>
        )}
        {probe === 'absent' && (
          <Hint onRetry={() => clearProbe(hostId)}>
            未在该主机上检测到 docker 命令。若已安装,请确认它在登录用户的 PATH 中。
          </Hint>
        )}
        {probe === 'denied' && (
          <Hint onRetry={() => clearProbe(hostId)}>
            当前用户无权访问 Docker(免密 sudo 也不可用)。常见做法是把用户加入 docker 组后重新 登录(
            <code className="rounded bg-[var(--nav-bg-hover)] px-1">usermod -aG docker 用户名</code>
            );rootless / podman 等环境请确认对应的 socket 可访问。
          </Hint>
        )}
        {(actionError || data.error) && (
          <div className="mb-2 break-all text-xs text-[var(--danger)]">
            {actionError || data.error}
          </div>
        )}

        {dockerCmd && section === 'containers' && (
          <>
            {!data.containers && !data.error && (
              <div className="text-xs text-[var(--text-muted)]">正在读取容器列表...</div>
            )}
            {data.containers && data.containers.length === 0 && (
              <div className="text-xs text-[var(--text-muted)]">没有容器</div>
            )}
            {data.containers && data.containers.length > 0 && matched.length === 0 && (
              <div className="text-xs text-[var(--text-muted)]">
                没有匹配「{query.trim()}」的容器
              </div>
            )}
            <div className="flex flex-col gap-3">
              {[...groups.entries()].map(([project, list]) => {
                const isCollapsed = collapsed.has(project)
                const running = list.filter((c) => c.state === 'running').length
                return (
                  <div key={project} className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          setCollapsed((prev) => {
                            const next = new Set(prev)
                            if (next.has(project)) next.delete(project)
                            else next.add(project)
                            return next
                          })
                        }
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[var(--nav-bg-hover)]"
                        title="折叠 / 展开该 compose 项目"
                      >
                        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <Layers3 size={13} className="shrink-0 text-[var(--accent)]" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-dark)]">
                          {project}
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                          {running}/{list.length} 运行中
                        </span>
                      </button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger
                          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
                          title="整组操作"
                        >
                          <MoreHorizontal size={14} />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            align="end"
                            sideOffset={4}
                            className="z-[70] min-w-[150px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
                          >
                            <GroupItem
                              icon={Play}
                              label="启动全部"
                              onSelect={() => void runGroup(project, list, 'start')}
                            />
                            <GroupItem
                              icon={RotateCw}
                              label="重启全部"
                              onSelect={() => void runGroup(project, list, 'restart')}
                            />
                            <GroupItem
                              icon={Square}
                              label="停止全部"
                              onSelect={() => void runGroup(project, list, 'stop')}
                            />
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                    {!isCollapsed && (
                      <div className="flex flex-col gap-2.5 border-l border-[var(--panel-border)] pl-2">
                        {list.map(cardFor)}
                      </div>
                    )}
                  </div>
                )
              })}
              {loose.length > 0 && (
                <div className="flex flex-col gap-2.5">{loose.map(cardFor)}</div>
              )}
            </div>
          </>
        )}

        {dockerCmd && section === 'images' && <ImagesSection ctx={ctx} filter={query} />}
        {dockerCmd && section === 'volumes' && (
          <VolumesSection ctx={ctx} filter={query} onOpenPath={openHostPath} />
        )}
        {dockerCmd && section === 'networks' && <NetworksSection ctx={ctx} filter={query} />}
        {dockerCmd && section === 'prune' && <PruneSection ctx={ctx} />}
      </div>

      {execFor && (
        <ExecOptionsModal
          containerName={execFor.name}
          onCancel={() => setExecFor(null)}
          onConfirm={(opts) => {
            const target = execFor
            setExecFor(null)
            openTerminal(target, opts)
          }}
        />
      )}
      {mountsFor && (
        <MountsModal
          ctx={ctx}
          containerId={mountsFor.id}
          containerName={mountsFor.name}
          onOpenPath={openHostPath}
          onClose={() => setMountsFor(null)}
        />
      )}
    </div>
  )
}

function GroupItem({
  icon: Icon,
  label,
  onSelect
}: {
  icon: typeof Play
  label: string
  onSelect: () => void
}): React.ReactElement {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
    >
      <Icon size={15} className="text-[var(--text-muted)]" />
      {label}
    </DropdownMenu.Item>
  )
}

function Hint({
  children,
  onRetry
}: {
  children: React.ReactNode
  onRetry: () => void
}): React.ReactElement {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3">
      <div className="text-xs leading-relaxed text-[var(--text-muted)]">{children}</div>
      <button
        onClick={onRetry}
        className="mt-2 flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
      >
        <RefreshCw size={12} />
        重新检测
      </button>
    </div>
  )
}
