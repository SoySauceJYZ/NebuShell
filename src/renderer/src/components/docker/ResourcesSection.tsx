import { useCallback, useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  RefreshCw,
  Trash2,
  FolderOpen,
  Layers,
  HardDrive,
  Network,
  Brush,
  Archive,
  RotateCcw,
  MoreHorizontal
} from 'lucide-react'
import { mapDockerError } from '@shared/dockerErrors'
import { useDockerStore } from '../../store/useDockerStore'
import { DEFAULT_BACKUP_DIR } from '../../lib/dockerVolumes'
import { VolumeBackupModal, VolumeRestoreModal } from './VolumeBackupModals'
import {
  buildImagesCommand,
  buildVolumesCommand,
  buildNetworksCommand,
  buildDiskUsageCommand,
  buildImageRemoveCommand,
  buildVolumeRemoveCommand,
  buildNetworkRemoveCommand,
  buildPruneCommand,
  parseImagesOutput,
  parseVolumesOutput,
  parseNetworksOutput,
  parseDiskUsageOutput,
  PRUNE_LABEL,
  type DiskUsageRow,
  type ImageInfo,
  type NetworkInfo,
  type PruneKind,
  type VolumeInfo
} from '../../lib/dockerContainers'
import type { DockerCtx } from './ctx'

/**
 * 镜像 / 卷 / 网络 / 清理。它们变化不频繁,所以**不参与轮询**:进入分区时拉一次,
 * 之后手动刷新或做完动作再拉 —— 既省服务器,也不会在你看的时候列表自己乱跳。
 */

function useResource<T>(
  ctx: DockerCtx,
  command: string,
  parse: (out: string) => T[]
): { items: T[] | null; error: string; loading: boolean; reload: () => void } {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.api.ssh
      .execFull(ctx.sessionId, command)
      .then((res) => {
        if (cancelled) return
        if (res.code !== 0) {
          setError(mapDockerError(res.stderr || res.stdout))
          return
        }
        setItems(parse(res.stdout))
        setError('')
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.sessionId, command, tick])

  // 转菊花在「点刷新」这个动作里置位,而不是在 effect 里 —— effect 内同步 setState
  // 会多触发一轮渲染(loading 初值本来就是 true,首次加载不受影响)。
  const reload = useCallback(() => {
    setLoading(true)
    setTick((n) => n + 1)
  }, [])

  return { items, error, loading, reload }
}

function SectionShell({
  title,
  count,
  loading,
  error,
  onReload,
  children
}: {
  title: string
  count?: number
  loading: boolean
  error: string
  onReload: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-dark)]">
          {title}
          {count !== undefined && <span className="ml-1 text-[var(--text-muted)]">{count}</span>}
        </span>
        <div className="flex-1" />
        <button
          onClick={onReload}
          title="刷新"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {error && <div className="break-all text-xs text-[var(--danger)]">{error}</div>}
      {children}
    </div>
  )
}

function Row({
  icon: Icon,
  title,
  subtitle,
  detail,
  badge,
  children
}: {
  icon: typeof Layers
  title: string
  subtitle?: string
  detail?: string
  badge?: string
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-2.5">
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={1.9} className="shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-dark)]" title={title}>
          {title}
        </span>
        {badge && (
          <span className="shrink-0 rounded bg-[var(--nav-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
            {badge}
          </span>
        )}
        {children}
      </div>
      {subtitle && (
        <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{subtitle}</div>
      )}
      {detail && (
        <div className="mt-0.5 break-all font-mono text-[10px] text-[var(--text-muted)]">
          {detail}
        </div>
      )}
    </div>
  )
}

function DeleteBtn({ onClick, title }: { onClick: () => void; title: string }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      className="shrink-0 rounded p-1 text-[var(--danger)] hover:bg-[var(--nav-bg-hover)]"
    >
      <Trash2 size={13} strokeWidth={1.75} />
    </button>
  )
}

// ---- 镜像 ------------------------------------------------------------------

export function ImagesSection({
  ctx,
  filter
}: {
  ctx: DockerCtx
  filter: string
}): React.ReactElement {
  const { items, error, loading, reload } = useResource<ImageInfo>(
    ctx,
    buildImagesCommand(ctx.dockerCmd),
    parseImagesOutput
  )
  const q = filter.trim().toLowerCase()
  const shown = (items ?? []).filter(
    (i) => !q || `${i.repository}:${i.tag}`.toLowerCase().includes(q)
  )

  const remove = async (img: ImageInfo): Promise<void> => {
    const name = img.dangling ? img.id.slice(0, 19) : `${img.repository}:${img.tag}`
    const ok = await window.api.dialog.confirm({
      message: `删除镜像 “${name}”?`,
      detail: '被容器占用的镜像会删除失败;删除后需要重新拉取才能再用。',
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (!ok) return
    if (await ctx.run(buildImageRemoveCommand(ctx.dockerCmd, img.id, false))) reload()
  }

  return (
    <SectionShell
      title="镜像"
      count={items?.length}
      loading={loading}
      error={error}
      onReload={reload}
    >
      {items && shown.length === 0 && (
        <div className="text-xs text-[var(--text-muted)]">{q ? '没有匹配的镜像' : '没有镜像'}</div>
      )}
      {shown.map((img) => (
        <Row
          key={img.id + img.tag}
          icon={Layers}
          title={img.dangling ? '<none>' : `${img.repository}:${img.tag}`}
          subtitle={`${img.size} · ${img.created}`}
          badge={img.dangling ? '悬空' : undefined}
        >
          <DeleteBtn onClick={() => void remove(img)} title="删除镜像" />
        </Row>
      ))}
    </SectionShell>
  )
}

// ---- 卷 --------------------------------------------------------------------

export function VolumesSection({
  ctx,
  filter,
  onOpenPath
}: {
  ctx: DockerCtx
  filter: string
  /** 在宿主机文件浏览器里打开卷的实际目录。 */
  onOpenPath: (hostPath: string) => void
}): React.ReactElement {
  const { items, error, loading, reload } = useResource<VolumeInfo>(
    ctx,
    buildVolumesCommand(ctx.dockerCmd),
    parseVolumesOutput
  )
  const q = filter.trim().toLowerCase()
  const shown = (items ?? []).filter((v) => !q || v.name.toLowerCase().includes(q))
  const backupDir = useDockerStore((s) => s.backupDirByHost[ctx.hostId]) ?? DEFAULT_BACKUP_DIR
  const setBackupDir = useDockerStore((s) => s.setBackupDir)
  const [backupFor, setBackupFor] = useState<VolumeInfo | null>(null)
  const [restoreFor, setRestoreFor] = useState<VolumeInfo | null>(null)
  /** 不带目标卷的还原(从备份新建一个卷)。 */
  const [restoreAny, setRestoreAny] = useState(false)

  const remove = async (v: VolumeInfo): Promise<void> => {
    const ok = await window.api.dialog.confirm({
      message: `删除卷 “${v.name}”?`,
      detail:
        '卷里的数据会一并删除,且无法恢复。被容器使用中的卷会删除失败。若还没备份过,建议先「备份…」。',
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (!ok) return
    if (await ctx.run(buildVolumeRemoveCommand(ctx.dockerCmd, v.name))) reload()
  }

  return (
    <SectionShell
      title="卷"
      count={items?.length}
      loading={loading}
      error={error}
      onReload={reload}
    >
      <button
        onClick={() => setRestoreAny(true)}
        className="flex items-center gap-1.5 self-start rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
      >
        <RotateCcw size={12} className="text-[var(--text-muted)]" />
        从备份还原…
      </button>
      {items && shown.length === 0 && (
        <div className="text-xs text-[var(--text-muted)]">{q ? '没有匹配的卷' : '没有卷'}</div>
      )}
      {shown.map((v) => (
        <Row key={v.name} icon={HardDrive} title={v.name} badge={v.driver} detail={v.mountpoint}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
              title="更多操作"
            >
              <MoreHorizontal size={13} strokeWidth={1.75} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-[70] min-w-[170px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
              >
                {v.mountpoint && (
                  <MenuItem
                    icon={FolderOpen}
                    label="在文件浏览器打开"
                    onSelect={() => onOpenPath(v.mountpoint)}
                  />
                )}
                <MenuItem icon={Archive} label="备份…" onSelect={() => setBackupFor(v)} />
                <MenuItem icon={RotateCcw} label="还原到此卷…" onSelect={() => setRestoreFor(v)} />
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
                <MenuItem icon={Trash2} label="删除卷" danger onSelect={() => void remove(v)} />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </Row>
      ))}

      {backupFor && (
        <VolumeBackupModal
          ctx={ctx}
          volume={backupFor.name}
          mountpoint={backupFor.mountpoint}
          backupDir={backupDir}
          onBackupDirChange={(d) => setBackupDir(ctx.hostId, d)}
          onOpenPath={onOpenPath}
          onClose={() => setBackupFor(null)}
        />
      )}
      {(restoreFor || restoreAny) && (
        <VolumeRestoreModal
          ctx={ctx}
          backupDir={backupDir}
          targetVolume={restoreFor?.name}
          onOpenPath={onOpenPath}
          onDone={reload}
          onClose={() => {
            setRestoreFor(null)
            setRestoreAny(false)
          }}
        />
      )}
    </SectionShell>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
  danger
}: {
  icon: typeof HardDrive
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

// ---- 网络 ------------------------------------------------------------------

export function NetworksSection({
  ctx,
  filter
}: {
  ctx: DockerCtx
  filter: string
}): React.ReactElement {
  const { items, error, loading, reload } = useResource<NetworkInfo>(
    ctx,
    buildNetworksCommand(ctx.dockerCmd),
    parseNetworksOutput
  )
  const q = filter.trim().toLowerCase()
  const shown = (items ?? []).filter((n) => !q || n.name.toLowerCase().includes(q))

  const remove = async (n: NetworkInfo): Promise<void> => {
    const ok = await window.api.dialog.confirm({
      message: `删除网络 “${n.name}”?`,
      detail: '仍有容器连接的网络会删除失败。',
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (!ok) return
    if (await ctx.run(buildNetworkRemoveCommand(ctx.dockerCmd, n.id))) reload()
  }

  return (
    <SectionShell
      title="网络"
      count={items?.length}
      loading={loading}
      error={error}
      onReload={reload}
    >
      {items && shown.length === 0 && (
        <div className="text-xs text-[var(--text-muted)]">{q ? '没有匹配的网络' : '没有网络'}</div>
      )}
      {shown.map((n) => (
        <Row key={n.id} icon={Network} title={n.name} subtitle={`${n.driver} · ${n.scope}`}>
          {!n.builtin && <DeleteBtn onClick={() => void remove(n)} title="删除网络" />}
        </Row>
      ))}
    </SectionShell>
  )
}

// ---- 清理(system df + prune) ----------------------------------------------

const PRUNE_ORDER: PruneKind[] = ['container', 'image', 'imageAll', 'volume', 'network', 'builder']

export function PruneSection({ ctx }: { ctx: DockerCtx }): React.ReactElement {
  const { items, error, loading, reload } = useResource<DiskUsageRow>(
    ctx,
    buildDiskUsageCommand(ctx.dockerCmd),
    parseDiskUsageOutput
  )
  const [result, setResult] = useState('')

  const prune = async (kind: PruneKind): Promise<void> => {
    const meta = PRUNE_LABEL[kind]
    const ok = await window.api.dialog.confirm({
      message: `${meta.title}?`,
      detail: `${meta.detail}\n\n该操作不可撤销。`,
      confirmLabel: '清理',
      cancelLabel: '取消'
    })
    if (!ok) return
    setResult('')
    const out = await ctx.query(buildPruneCommand(ctx.dockerCmd, kind))
    if (out === null) return
    // docker prune 末尾会打印 'Total reclaimed space: xxx',把它直接回显给用户。
    const line = out.split('\n').find((l) => /reclaimed space/i.test(l))
    setResult(line?.trim() || '已完成,没有可回收的内容。')
    reload()
    ctx.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionShell title="磁盘占用" loading={loading} error={error} onReload={reload}>
        {items && items.length > 0 && (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--panel-border)]">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-[var(--content-bg)] text-[var(--text-muted)]">
                  <th className="px-2 py-1 text-left font-normal">类型</th>
                  <th className="px-2 py-1 text-right font-normal">数量</th>
                  <th className="px-2 py-1 text-right font-normal">占用</th>
                  <th className="px-2 py-1 text-right font-normal">可回收</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.type} className="border-t border-[var(--panel-border)]">
                    <td className="px-2 py-1 text-[var(--text-dark)]">{r.type}</td>
                    <td className="px-2 py-1 text-right text-[var(--text-muted)]">
                      {r.active}/{r.total}
                    </td>
                    <td className="px-2 py-1 text-right text-[var(--text-dark)]">{r.size}</td>
                    <td className="px-2 py-1 text-right text-[var(--accent)]">{r.reclaimable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--text-dark)]">清理</span>
        {result && <div className="break-all text-xs text-[var(--accent)]">{result}</div>}
        {PRUNE_ORDER.map((kind) => (
          <button
            key={kind}
            onClick={() => void prune(kind)}
            disabled={ctx.busy}
            className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--panel-border)] p-2.5 text-left hover:bg-[var(--nav-bg-hover)] disabled:opacity-50"
          >
            <Brush size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0">
              <span className="block text-[12px] text-[var(--text-dark)]">
                {PRUNE_LABEL[kind].title}
              </span>
              <span className="block text-[11px] leading-relaxed text-[var(--text-muted)]">
                {PRUNE_LABEL[kind].detail}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
