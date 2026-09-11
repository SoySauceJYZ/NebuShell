import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Container,
  Play,
  Square,
  RotateCw,
  ScrollText,
  FileText,
  Terminal,
  FolderOpen,
  MoreHorizontal,
  Pause,
  PlayCircle,
  Zap,
  Trash2,
  HardDrive,
  UserCog,
  Settings2,
  Copy,
  Info,
  ExternalLink,
  Cpu,
  MemoryStick
} from 'lucide-react'
import {
  parsePorts,
  portUrl,
  type ContainerInfo,
  type ContainerStat,
  type ContainerVerb
} from '../../lib/dockerContainers'
import type { DockerCtx } from './ctx'

const STATE_STYLE: Record<string, { label: string; cls: string }> = {
  running: { label: '运行中', cls: 'bg-green-500/15 text-green-600' },
  paused: { label: '已暂停', cls: 'bg-amber-500/15 text-amber-600' },
  restarting: { label: '重启中', cls: 'bg-amber-500/15 text-amber-600' },
  exited: { label: '已停止', cls: 'bg-[var(--nav-bg-hover)] text-[var(--text-muted)]' },
  created: { label: '已创建', cls: 'bg-[var(--nav-bg-hover)] text-[var(--text-muted)]' },
  dead: { label: 'dead', cls: 'bg-red-500/15 text-[var(--danger)]' },
  unknown: { label: '未知', cls: 'bg-[var(--nav-bg-hover)] text-[var(--text-muted)]' }
}

const HEALTH_STYLE: Record<string, { label: string; cls: string }> = {
  healthy: { label: '健康', cls: 'bg-green-500/15 text-green-600' },
  unhealthy: { label: '不健康', cls: 'bg-red-500/15 text-[var(--danger)]' },
  starting: { label: '健康检查中', cls: 'bg-amber-500/15 text-amber-600' }
}

export interface CardActions {
  onAction: (verb: ContainerVerb) => void
  onTerminal: (opts?: { user?: string }) => void
  onCustomTerminal: () => void
  onFiles: () => void
  onLogsFollow: () => void
  onLogsEditor: () => void
  onMounts: () => void
  onInspect: () => void
}

export function ContainerCard({
  c,
  stat,
  ctx,
  busy,
  actions
}: {
  c: ContainerInfo
  stat?: ContainerStat
  ctx: DockerCtx
  busy: boolean
  actions: CardActions
}): React.ReactElement {
  const st = STATE_STYLE[c.state] ?? STATE_STYLE.unknown
  const health = c.health ? HEALTH_STYLE[c.health] : undefined
  const running = c.state === 'running'
  const paused = c.state === 'paused'
  const ports = parsePorts(c.ports)

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3">
      <div className="flex items-center gap-2">
        <Container size={15} strokeWidth={1.9} className="shrink-0 text-[var(--accent)]" />
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-dark)]"
          title={c.name}
        >
          {c.service && c.project ? c.service : c.name}
        </span>
        {health && (
          <span
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${health.cls}`}
          >
            {health.label}
          </span>
        )}
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

      {/* 发布出来的端口:能点,直接用系统浏览器打开 host:port。 */}
      {ports.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ports.map((p) => {
            const url = portUrl(p, ctx.hostAddress)
            const label = `${p.hostPort}→${p.containerPort}`
            return url ? (
              <button
                key={`${p.hostPort}/${p.proto}`}
                onClick={() => void window.api.local.openUrl(url)}
                title={`在浏览器打开 ${url}`}
                className="flex items-center gap-1 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent)] hover:underline"
              >
                {label}
                <ExternalLink size={9} />
              </button>
            ) : (
              <span
                key={`${p.hostPort}/${p.proto}`}
                className="rounded bg-[var(--nav-bg-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
              >
                {label}/{p.proto}
              </span>
            )
          })}
        </div>
      )}

      {/* 资源占用(只有运行中且开启了 stats 采集时才有数据)。 */}
      {running && stat && (
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1" title="CPU 占用">
            <Cpu size={11} />
            {stat.cpu}
          </span>
          <span className="flex min-w-0 items-center gap-1" title={`内存 ${stat.mem}`}>
            <MemoryStick size={11} />
            <span className="truncate">
              {stat.mem} ({stat.memPerc})
            </span>
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-0.5 border-t border-[var(--panel-border)] pt-1.5">
        <IconBtn
          icon={Terminal}
          title={running ? '容器终端' : '容器需在运行状态'}
          onClick={() => actions.onTerminal()}
          disabled={!running}
        />
        {/* 容器文件:停止的容器也能看 —— docker cp 不需要容器在跑。 */}
        <IconBtn
          icon={FolderOpen}
          title={running ? '容器文件' : '容器文件(已停止:只读浏览/导出)'}
          onClick={actions.onFiles}
        />
        <IconBtn
          icon={ScrollText}
          title="日志(新开标签页实时跟随)"
          onClick={actions.onLogsFollow}
          disabled={busy}
        />
        <IconBtn
          icon={FileText}
          title="日志(在编辑器中查看,可选行数/时间戳/自动刷新)"
          onClick={actions.onLogsEditor}
          disabled={busy}
        />
        <div className="flex-1" />
        {running || paused ? (
          <>
            <IconBtn
              icon={RotateCw}
              title="重启"
              onClick={() => actions.onAction('restart')}
              disabled={busy}
            />
            <IconBtn
              icon={Square}
              title="停止"
              onClick={() => actions.onAction('stop')}
              disabled={busy}
              danger
            />
          </>
        ) : (
          <IconBtn
            icon={Play}
            title="启动"
            onClick={() => actions.onAction('start')}
            disabled={busy}
          />
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
            title="更多操作"
          >
            <MoreHorizontal size={14} strokeWidth={1.75} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-[70] min-w-[190px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
            >
              {running && (
                <Item
                  icon={UserCog}
                  label="以 root 进入"
                  onSelect={() => actions.onTerminal({ user: 'root' })}
                />
              )}
              {running && (
                <Item icon={Settings2} label="自定义进入…" onSelect={actions.onCustomTerminal} />
              )}
              {running && (
                <Item icon={Pause} label="暂停" onSelect={() => actions.onAction('pause')} />
              )}
              {paused && (
                <Item icon={PlayCircle} label="恢复" onSelect={() => actions.onAction('unpause')} />
              )}
              {(running || paused) && (
                <Item
                  icon={Zap}
                  label="强制终止 (kill)"
                  onSelect={() => actions.onAction('kill')}
                />
              )}
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
              <Item icon={HardDrive} label="挂载点 / 卷" onSelect={actions.onMounts} />
              <Item icon={Info} label="查看详情 (inspect)" onSelect={actions.onInspect} />
              <Item
                icon={Copy}
                label="复制容器 ID"
                onSelect={() => window.api.clipboard.writeText(c.id)}
              />
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
              <Item
                icon={Trash2}
                label="删除容器"
                danger
                onSelect={() => actions.onAction(running || paused ? 'rmForce' : 'rm')}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}

function Item({
  icon: Icon,
  label,
  onSelect,
  danger
}: {
  icon: typeof Play
  label: string
  onSelect: () => void
  danger?: boolean
}): React.ReactElement {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)] ${
        danger ? 'text-[var(--danger)]' : 'text-[var(--text-dark)]'
      }`}
    >
      <Icon size={15} className={danger ? '' : 'text-[var(--text-muted)]'} />
      {label}
    </DropdownMenu.Item>
  )
}

export function IconBtn({
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
