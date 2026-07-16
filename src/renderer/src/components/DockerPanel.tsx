import { useEffect, useRef, useState } from 'react'
import {
  Container,
  Play,
  Square,
  RotateCw,
  ScrollText,
  Terminal,
  FolderOpen,
  RefreshCw
} from 'lucide-react'
import { useDockerStore } from '../store/useDockerStore'
import { useSessionStore } from '../store/useSessionStore'
import { useVaultStore } from '../store/useVaultStore'
import {
  PROBE_COMMAND,
  parseProbeOutput,
  buildPsCommand,
  parsePsOutput,
  type ContainerInfo
} from '../lib/dockerContainers'

const POLL_MS = 4000

// 状态徽标配色
const STATE_STYLE: Record<string, { label: string; cls: string }> = {
  running: { label: '运行中', cls: 'bg-green-500/15 text-green-600' },
  paused: { label: '已暂停', cls: 'bg-amber-500/15 text-amber-600' },
  restarting: { label: '重启中', cls: 'bg-amber-500/15 text-amber-600' },
  exited: { label: '已停止', cls: 'bg-[var(--nav-bg-hover)] text-[var(--text-muted)]' },
  created: { label: '已创建', cls: 'bg-[var(--nav-bg-hover)] text-[var(--text-muted)]' },
  dead: { label: 'dead', cls: 'bg-red-500/15 text-[var(--danger)]' },
  unknown: { label: '未知', cls: 'bg-[var(--nav-bg-hover)] text-[var(--text-muted)]' }
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
  const openTab = useSessionStore((s) => s.openTab)
  const hostLabel = useVaultStore((s) => s.hosts.find((h) => h.id === hostId)?.label) ?? '主机'

  const dockerCmd = probe === 'docker' || probe === 'sudo -n docker' ? probe : null
  const [containers, setContainers] = useState<ContainerInfo[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pollTick, setPollTick] = useState(0)

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
      .exec(sessionId, PROBE_COMMAND)
      .then((out) => {
        if (!cancelled) setProbe(hostId, parseProbeOutput(out))
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [connected, probe, sessionId, hostId, setProbe])

  // 轮询 docker ps(仿 MonitorPanel)
  useEffect(() => {
    if (!connected || !dockerCmd) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const out = await window.api.ssh.exec(sessionId, buildPsCommand(dockerCmd))
        if (cancelled) return
        setContainers(parsePsOutput(out))
        setError('')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void poll()
    const t = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [connected, dockerCmd, sessionId, pollTick])

  const repoll = (): void => setPollTick((n) => n + 1)

  const runAction = async (c: ContainerInfo, verb: 'start' | 'stop' | 'restart'): Promise<void> => {
    if (!dockerCmd || busyId) return
    setBusyId(c.id)
    try {
      const out = await window.api.ssh.exec(sessionId, `${dockerCmd} ${verb} ${c.id} 2>&1`)
      // 成功时 docker 会回显容器 id;否则输出即错误文本
      if (!out.includes(c.id.slice(0, 12))) setError(out.trim().slice(0, 300))
      else setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
      repoll()
    }
  }

  const openLogs = (c: ContainerInfo): void => {
    if (!dockerCmd) return
    openTab({
      id: `editor-logs-${c.id.slice(0, 12)}-${Date.now()}`,
      kind: 'editor',
      title: `日志: ${c.name}`,
      editorExecCommand: `${dockerCmd} logs --tail 500 ${c.id} 2>&1`,
      editorSourceSessionId: sessionId,
      editorLang: 'plaintext'
    })
  }

  const openTerminal = (c: ContainerInfo): void => {
    if (!dockerCmd) return
    openTab({
      id: `terminal-${hostId}-${Date.now()}`,
      kind: 'terminal',
      title: `${c.name} @ ${hostLabel}`,
      hostId,
      containerId: c.id,
      containerName: c.name,
      dockerCmd
    })
  }

  const openFiles = (c: ContainerInfo): void => {
    if (!dockerCmd) return
    openTab({
      id: `explorer-cfs-${c.id.slice(0, 12)}-${Date.now()}`,
      kind: 'explorer',
      title: `${c.name} (文件)`,
      hostId,
      explorerContainerId: c.id,
      explorerContainerName: c.name,
      dockerCmd
    })
  }

  return (
    <div className="flex h-full flex-col">
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
              onClick={repoll}
              title="刷新"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
            >
              <RefreshCw size={13} />
            </button>
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!connected && <div className="text-xs text-[var(--text-muted)]">未连接</div>}
        {connected && !probe && <div className="text-xs text-[var(--text-muted)]">正在检测 Docker...</div>}
        {probe === 'absent' && (
          <Hint onRetry={() => clearProbe(hostId)}>
            未在该主机上检测到 docker 命令。若已安装,请确认它在登录用户的 PATH 中。
          </Hint>
        )}
        {probe === 'denied' && (
          <Hint onRetry={() => clearProbe(hostId)}>
            当前用户无权访问 Docker(免密 sudo 也不可用)。可让管理员执行
            <code className="mx-1 rounded bg-[var(--nav-bg-hover)] px-1">
              sudo usermod -aG docker {'<用户名>'}
            </code>
            后重新登录。
          </Hint>
        )}
        {error && <div className="mb-2 break-all text-xs text-[var(--danger)]">{error}</div>}
        {dockerCmd && containers && containers.length === 0 && (
          <div className="text-xs text-[var(--text-muted)]">没有容器</div>
        )}
        {dockerCmd && !containers && !error && (
          <div className="text-xs text-[var(--text-muted)]">正在读取容器列表...</div>
        )}
        {containers && containers.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {containers.map((c) => (
              <ContainerCard
                key={c.id}
                c={c}
                busy={busyId === c.id}
                onAction={(verb) => void runAction(c, verb)}
                onLogs={() => openLogs(c)}
                onTerminal={() => openTerminal(c)}
                onFiles={() => openFiles(c)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
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

function IconBtn({
  icon: Icon,
  title,
  onClick,
  disabled,
  danger
}: {
  icon: typeof Play
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded p-1 ${
        danger ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'
      } hover:bg-[var(--nav-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <Icon size={14} strokeWidth={1.75} />
    </button>
  )
}

function ContainerCard({
  c,
  busy,
  onAction,
  onLogs,
  onTerminal,
  onFiles
}: {
  c: ContainerInfo
  busy: boolean
  onAction: (verb: 'start' | 'stop' | 'restart') => void
  onLogs: () => void
  onTerminal: () => void
  onFiles: () => void
}): React.ReactElement {
  const st = STATE_STYLE[c.state] ?? STATE_STYLE.unknown
  const running = c.state === 'running' || c.state === 'paused'
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3">
      <div className="flex items-center gap-2">
        <Container size={15} strokeWidth={1.9} className="shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-dark)]" title={c.name}>
          {c.name}
        </span>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>
          {st.label}
        </span>
      </div>
      <div className="mt-1.5 truncate text-[11px] text-[var(--text-muted)]" title={c.image}>
        {c.image}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]" title={c.status}>
        {c.status}
      </div>
      {c.ports && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]" title={c.ports}>
          {c.ports}
        </div>
      )}
      <div className="mt-2 flex items-center gap-0.5 border-t border-[var(--panel-border)] pt-1.5">
        <IconBtn
          icon={Terminal}
          title={c.state === 'running' ? '容器终端' : '容器需在运行状态'}
          onClick={onTerminal}
          disabled={c.state !== 'running'}
        />
        <IconBtn
          icon={FolderOpen}
          title={c.state === 'running' ? '容器文件' : '容器需在运行状态'}
          onClick={onFiles}
          disabled={c.state !== 'running'}
        />
        <IconBtn icon={ScrollText} title="查看日志" onClick={onLogs} disabled={busy} />
        <div className="flex-1" />
        {running ? (
          <>
            <IconBtn icon={RotateCw} title="重启" onClick={() => onAction('restart')} disabled={busy} />
            <IconBtn icon={Square} title="停止" onClick={() => onAction('stop')} disabled={busy} danger />
          </>
        ) : (
          <IconBtn icon={Play} title="启动" onClick={() => onAction('start')} disabled={busy} />
        )}
      </div>
    </div>
  )
}
