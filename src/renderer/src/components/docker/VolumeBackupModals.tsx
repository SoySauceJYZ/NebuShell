import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArrowDownToLine,
  Check,
  CircleAlert,
  FolderOpen,
  Loader2,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import { mapDockerError } from '@shared/dockerErrors'
import type { ExecResult, TransferProgress } from '@shared/types'
import { useVaultStore } from '../../store/useVaultStore'
import { resolveConnectOptions } from '../../lib/resolveConnectOptions'
import { buildImagesCommand, parseImagesOutput } from '../../lib/dockerContainers'
import {
  ARCHIVE_SUFFIX,
  SIDECAR_SUFFIX,
  TAR_FLAG_LADDER,
  archiveLooksGood,
  backupBaseName,
  timeStamp,
  buildAccessProbeCommand,
  buildBackupCommand,
  buildClearVolumeCommand,
  buildDeleteBackupCommand,
  buildHelperProbeCommand,
  buildHelperSizeCommand,
  buildListArchivesCommand,
  buildListSidecarsCommand,
  buildRestoreCommand,
  buildSidecarCommand,
  buildSizeProbeCommand,
  buildStartCommand,
  buildStopCommand,
  buildVerifyArchiveCommand,
  buildVolumeCreateCommand,
  buildVolumeMountpointCommand,
  buildVolumeUsersCommand,
  describeMethod,
  formatBytes,
  formatTime,
  helperHasTar,
  isRunning,
  isUnsupportedFlagError,
  joinExpr,
  mergeBackupList,
  parseAccessProbe,
  parseHelperSize,
  parseVolumeUsers,
  pickHelperImage,
  type BackupEntry,
  type BackupMeta,
  type PackMethod,
  type VolumeUser
} from '../../lib/dockerVolumes'
import type { DockerCtx } from './ctx'

// ---- 公共小件 ---------------------------------------------------------------

type StepState = 'pending' | 'running' | 'ok' | 'fail' | 'skip'
interface Step {
  label: string
  state: StepState
  note?: string
}

function Shell({
  title,
  subtitle,
  busy,
  onClose,
  children,
  footer
}: {
  title: string
  subtitle?: string
  busy: boolean
  onClose: () => void
  children: React.ReactNode
  footer: React.ReactNode
}): React.ReactElement {
  return (
    <div
      className="absolute inset-0 z-[90] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={() => !busy && onClose()}
    >
      <div
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 border-b border-[var(--panel-border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--text-dark)]">{title}</div>
            {subtitle && (
              <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]" title={subtitle}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            title={busy ? '进行中,请等它跑完' : '关闭'}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--panel-border)] px-4 py-3">
          {footer}
        </div>
      </div>
    </div>
  )
}

function InfoRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex gap-2 py-1 text-xs">
      <span className="w-20 shrink-0 text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 flex-1 break-all text-[var(--text-dark)]">{children}</span>
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mt-2 flex gap-2 rounded-[var(--radius-sm)] bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700">
      <CircleAlert size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function Danger({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mt-2 break-all rounded-[var(--radius-sm)] bg-red-500/10 p-2.5 text-xs leading-relaxed text-[var(--danger)]">
      {children}
    </div>
  )
}

function StepList({ steps }: { steps: Step[] }): React.ReactElement {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="mt-0.5 w-3.5 shrink-0">
            {s.state === 'running' && (
              <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
            )}
            {s.state === 'ok' && <Check size={13} className="text-green-600" />}
            {s.state === 'fail' && <X size={13} className="text-[var(--danger)]" />}
            {s.state === 'skip' && <span className="text-[var(--text-muted)]">–</span>}
            {s.state === 'pending' && <span className="text-[var(--text-muted)]">·</span>}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={
                s.state === 'fail'
                  ? 'text-[var(--danger)]'
                  : s.state === 'pending'
                    ? 'text-[var(--text-muted)]'
                    : 'text-[var(--text-dark)]'
              }
            >
              {s.label}
            </span>
            {s.note && <span className="ml-1.5 break-all text-[var(--text-muted)]">{s.note}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function Bar({ done, total }: { done: number; total: number | null }): React.ReactElement {
  const pct = total && total > 0 ? Math.min(99, Math.round((done / total) * 100)) : null
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--nav-bg-hover)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all"
          style={{ width: pct === null ? '35%' : `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--text-muted)]">
        已写入 {formatBytes(done)}
        {total ? ` · 源 ${formatBytes(total)}(压缩后通常更小,进度为估算)` : ''}
      </div>
    </div>
  )
}

/** 跑一条命令,异常也折成 ExecResult,调用方只看 code。 */
function useRunner(sessionId: string): (command: string) => Promise<ExecResult> {
  return useCallback(
    async (command: string): Promise<ExecResult> => {
      try {
        return await window.api.ssh.execFull(sessionId, command)
      } catch (e) {
        return { stdout: '', stderr: e instanceof Error ? e.message : String(e), code: 1 }
      }
    },
    [sessionId]
  )
}

const errText = (r: ExecResult): string => mapDockerError(r.stderr || r.stdout)

/**
 * 按 tar 参数阶梯执行:busybox 的 tar 不认 --numeric-owner/--xattrs,报「无法识别的选项」
 * 时降一级重试,而不是直接判失败。返回最终结果与实际生效的参数。
 */
async function runWithTarFlags(
  run: (cmd: string) => Promise<ExecResult>,
  build: (flags: string[]) => string
): Promise<{ res: ExecResult; flags: string[] }> {
  let last: ExecResult = { stdout: '', stderr: '', code: 1 }
  for (const flags of TAR_FLAG_LADDER) {
    last = await run(build(flags))
    if (last.code === 0) return { res: last, flags }
    if (!isUnsupportedFlagError(last.stderr)) return { res: last, flags }
  }
  return { res: last, flags: [] }
}

/**
 * 选定打包方式:能直接读卷目录就直连(最快),否则找一个自带 tar 的本地镜像起一次性容器。
 */
async function resolveMethod(
  run: (cmd: string) => Promise<ExecResult>,
  dockerCmd: string,
  volume: string,
  mountpoint: string,
  backupDir: string
): Promise<{
  method: PackMethod | null
  sizeBytes: number | null
  freeBytes: number | null
  error: string
}> {
  const probeRes = await run(buildAccessProbeCommand(dockerCmd, mountpoint, backupDir))
  const probe = parseAccessProbe(probeRes.stdout)
  if (probe.direct) {
    return {
      method: { kind: 'direct', mountpoint },
      sizeBytes: probe.sizeBytes,
      freeBytes: probe.freeBytes,
      error: ''
    }
  }
  // 读不到卷目录(普通用户 + 无免密 sudo)→ 找个能用的镜像
  const usersRes = await run(buildVolumeUsersCommand(dockerCmd, volume))
  const users = usersRes.code === 0 ? parseVolumeUsers(usersRes.stdout) : []
  const imagesRes = await run(buildImagesCommand(dockerCmd))
  const images = imagesRes.code === 0 ? parseImagesOutput(imagesRes.stdout) : []
  const image = pickHelperImage(users, images)
  if (!image) {
    return {
      method: null,
      sizeBytes: null,
      freeBytes: probe.freeBytes,
      error:
        '读不到卷目录(需要 root 或免密 sudo),主机上也没有可用来打包的镜像。可以 docker pull alpine 后重试,或让管理员放开 sudo。'
    }
  }
  const tarRes = await run(buildHelperProbeCommand(dockerCmd, image))
  if (!helperHasTar(tarRes.stdout)) {
    return {
      method: null,
      sizeBytes: null,
      freeBytes: probe.freeBytes,
      error: `读不到卷目录,候选镜像 ${image} 里也没有 tar。可以 docker pull alpine 后重试。`
    }
  }
  const sizeRes = await run(buildHelperSizeCommand(dockerCmd, image, volume))
  return {
    method: { kind: 'helper', image },
    sizeBytes: sizeRes.code === 0 ? parseHelperSize(sizeRes.stdout) : null,
    freeBytes: probe.freeBytes,
    error: ''
  }
}

// ---- 备份 -------------------------------------------------------------------

export function VolumeBackupModal({
  ctx,
  volume,
  mountpoint,
  backupDir,
  onBackupDirChange,
  onOpenPath,
  onClose
}: {
  ctx: DockerCtx
  volume: string
  mountpoint: string
  backupDir: string
  onBackupDirChange: (dir: string) => void
  onOpenPath: (hostPath: string) => void
  onClose: () => void
}): React.ReactElement {
  const run = useRunner(ctx.sessionId)
  const hosts = useVaultStore((s) => s.hosts)
  const credentials = useVaultStore((s) => s.credentials)
  const [dir, setDir] = useState(backupDir)
  const [users, setUsers] = useState<VolumeUser[]>([])
  const [method, setMethod] = useState<PackMethod | null>(null)
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [freeBytes, setFreeBytes] = useState<number | null>(null)
  const [preflightErr, setPreflightErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [stopFirst, setStopFirst] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [written, setWritten] = useState(0)
  const [donePath, setDonePath] = useState('')
  const [doneSize, setDoneSize] = useState(0)
  const [failure, setFailure] = useState('')
  const [dl, setDl] = useState<TransferProgress | null>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const runningUsers = users.filter(isRunning)

  /** 预检:查使用中的容器 + 选打包方式 + 量大小与剩余空间。全部在 await 之后落状态。 */
  const preflight = useCallback(
    async (targetDir: string) => {
      const usersRes = await run(buildVolumeUsersCommand(ctx.dockerCmd, volume))
      const r = await resolveMethod(run, ctx.dockerCmd, volume, mountpoint, targetDir)
      if (!alive.current) return
      setUsers(usersRes.code === 0 ? parseVolumeUsers(usersRes.stdout) : [])
      setMethod(r.method)
      setSizeBytes(r.sizeBytes)
      setFreeBytes(r.freeBytes)
      setPreflightErr(r.error)
      setLoading(false)
    },
    [run, ctx.dockerCmd, volume, mountpoint]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await preflight(dir)
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tight = sizeBytes !== null && freeBytes !== null && freeBytes < sizeBytes

  const start = async (): Promise<void> => {
    if (!method) return
    setRunning(true)
    setFailure('')
    setWritten(0)
    onBackupDirChange(dir)
    const base = backupBaseName(volume)
    const archiveExpr = joinExpr(dir, base + ARCHIVE_SUFFIX)
    const sidecarExpr = joinExpr(dir, base + SIDECAR_SUFFIX)
    const toStop = stopFirst ? runningUsers : []

    const plan: Step[] = [
      ...(toStop.length
        ? [{ label: `停止 ${toStop.length} 个容器`, state: 'pending' as StepState }]
        : []),
      { label: '打包卷内容', state: 'pending' },
      { label: '写入备份信息', state: 'pending' },
      ...(toStop.length ? [{ label: '重新启动容器', state: 'pending' as StepState }] : [])
    ]
    setSteps(plan)
    const mark = (i: number, state: StepState, note?: string): void =>
      setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, state, note } : s)))

    let idx = 0
    let stopped = false
    try {
      if (toStop.length) {
        mark(idx, 'running')
        const r = await run(
          buildStopCommand(
            ctx.dockerCmd,
            toStop.map((u) => u.id)
          )
        )
        if (r.code !== 0) {
          mark(idx, 'fail', errText(r))
          setFailure(errText(r))
          return
        }
        stopped = true
        mark(idx, 'ok')
        idx++
      }

      // 打包(带进度轮询:每 1.5s 看一眼目标文件多大了)
      mark(idx, 'running')
      const poll = setInterval(() => {
        void run(buildSizeProbeCommand(archiveExpr)).then((r) => {
          if (alive.current) setWritten(Number(r.stdout.trim()) || 0)
        })
      }, 1500)
      const { res, flags } = await runWithTarFlags(run, (f) =>
        buildBackupCommand(ctx.dockerCmd, method, volume, archiveExpr, f)
      )
      clearInterval(poll)
      if (res.code !== 0) {
        mark(idx, 'fail', errText(res))
        setFailure(errText(res))
        return
      }
      const sizeRes = await run(buildSizeProbeCommand(archiveExpr))
      const finalSize = Number(sizeRes.stdout.trim()) || 0
      setWritten(finalSize)
      setDoneSize(finalSize)
      mark(idx, 'ok', formatBytes(finalSize))
      idx++

      // 边车元数据
      mark(idx, 'running')
      const meta: BackupMeta = {
        v: 1,
        volume,
        host: ctx.hostLabel,
        createdAt: new Date().toISOString(),
        sizeBytes,
        method: method.kind,
        image: method.kind === 'helper' ? method.image : undefined,
        tarFlags: flags,
        users: users.map((u) => u.name),
        stopped
      }
      const metaRes = await run(buildSidecarCommand(sidecarExpr, meta))
      mark(
        idx,
        metaRes.code === 0 ? 'ok' : 'fail',
        metaRes.code === 0 ? undefined : errText(metaRes)
      )
      idx++

      // 归档路径用于「打开目录 / 下载」:此处把 ~ 展开成真实路径拿回来
      const pathRes = await run(`printf '%s' ${archiveExpr}`)
      if (alive.current) setDonePath(pathRes.stdout.trim())
    } finally {
      if (stopped) {
        // 不管成败都要把容器拉回来 —— 绝不能让备份失败顺带把服务停在那儿。
        const i = plan.length - 1
        mark(i, 'running')
        const r = await run(
          buildStartCommand(
            ctx.dockerCmd,
            toStop.map((u) => u.id)
          )
        )
        mark(i, r.code === 0 ? 'ok' : 'fail', r.code === 0 ? undefined : errText(r))
      }
      if (alive.current) setRunning(false)
      ctx.refresh()
    }
  }

  /** 把备份文件拉到本机:临时开一条 SFTP 会话,复用现成的下载与进度。 */
  const download = async (): Promise<void> => {
    const host = hosts.find((h) => h.id === ctx.hostId)
    if (!host || !donePath) return
    const localDir = await window.api.local.pickDir()
    if (!localDir) return
    const sid = `${ctx.sessionId}::volbak`
    const transferId = crypto?.randomUUID ? crypto.randomUUID() : `t-${Date.now()}`
    const off = window.api.transfers.onProgress(transferId, (p) => {
      if (alive.current) setDl(p)
    })
    try {
      await window.api.sftp.connect(resolveConnectOptions(sid, host, credentials))
      await window.api.sftp.downloadTo(sid, donePath, localDir, transferId)
    } catch (e) {
      if (alive.current) setFailure(e instanceof Error ? e.message : String(e))
    } finally {
      off()
      window.api.sftp.disconnect(sid)
    }
  }

  const dirOfArchive = donePath.slice(0, donePath.lastIndexOf('/')) || dir

  return (
    <Shell
      title="备份卷"
      subtitle={volume}
      busy={running}
      onClose={onClose}
      footer={
        donePath ? (
          <>
            <button
              onClick={() => onOpenPath(dirOfArchive)}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              <FolderOpen size={13} />在 SFTP 中打开
            </button>
            <button onClick={() => void download()} className="btn-secondary px-3 py-1.5 text-xs">
              <ArrowDownToLine size={13} />
              下载到本机…
            </button>
            <button onClick={onClose} className="btn-primary px-3 py-1.5 text-xs">
              完成
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onClose}
              disabled={running}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              取消
            </button>
            <button
              onClick={() => void start()}
              disabled={running || loading || !method}
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            >
              <Archive size={13} />
              {running ? '备份中…' : '开始备份'}
            </button>
          </>
        )
      }
    >
      {loading && <div className="text-xs text-[var(--text-muted)]">正在预检…</div>}
      {!loading && (
        <>
          <InfoRow label="卷大小">{formatBytes(sizeBytes)}</InfoRow>
          <InfoRow label="打包方式">
            {method ? describeMethod(method) : <span className="text-[var(--danger)]">不可用</span>}
          </InfoRow>
          <InfoRow label="目标可用">{formatBytes(freeBytes)}</InfoRow>
          <label className="mt-2 flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">备份到主机目录</span>
            <input
              className="input w-full text-xs"
              spellCheck={false}
              value={dir}
              disabled={running}
              onChange={(e) => setDir(e.target.value)}
              onBlur={() => {
                setLoading(true)
                void preflight(dir)
              }}
            />
          </label>

          {users.length > 0 && (
            <>
              <InfoRow label="使用中">
                {users.map((u) => `${u.name}(${u.state})`).join('、')}
              </InfoRow>
              {runningUsers.length > 0 && (
                <label className="mt-1 flex items-start gap-2 text-xs text-[var(--text-dark)]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={stopFirst}
                    disabled={running}
                    onChange={(e) => setStopFirst(e.target.checked)}
                  />
                  <span>
                    先停止 {runningUsers.map((u) => u.name).join('、')},备份完自动启动
                    <span className="block text-[var(--text-muted)]">
                      不停的话得到的是「崩溃一致」快照 —— 数据库类的卷建议勾上。
                    </span>
                  </span>
                </label>
              )}
            </>
          )}

          {preflightErr && <Danger>{preflightErr}</Danger>}
          {tight && (
            <Warn>
              目标分区可用 {formatBytes(freeBytes)},小于卷的 {formatBytes(sizeBytes)}
              。压缩后通常会小 不少,但仍有写满磁盘的风险,建议换个目录或先清理。
            </Warn>
          )}
          {steps.length > 0 && <StepList steps={steps} />}
          {running && <Bar done={written} total={sizeBytes} />}
          {failure && <Danger>{failure}</Danger>}
          {donePath && (
            <div className="mt-3 rounded-[var(--radius-sm)] bg-green-500/10 p-2.5 text-xs text-green-700">
              已备份到 <span className="break-all font-mono">{donePath}</span>(
              {formatBytes(doneSize)})
            </div>
          )}
          {dl && (
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              {dl.phase === 'done'
                ? '已下载到本机'
                : dl.phase === 'error'
                  ? `下载失败:${dl.error ?? ''}`
                  : `下载中 ${formatBytes(dl.doneBytes)} / ${formatBytes(dl.totalBytes)}`}
            </div>
          )}
          {!running && !donePath && (
            <div className="mt-3 text-[10px] leading-relaxed text-[var(--text-muted)]">
              备份在服务器上执行,关掉这个窗口不会中断它;大卷可能要跑一会儿。
            </div>
          )}
        </>
      )}
    </Shell>
  )
}

// ---- 还原 -------------------------------------------------------------------

export function VolumeRestoreModal({
  ctx,
  backupDir,
  targetVolume,
  onOpenPath,
  onDone,
  onClose
}: {
  ctx: DockerCtx
  backupDir: string
  /** 从卷卡片进来时预设的目标卷;从分区顶部进来时为空。 */
  targetVolume?: string
  onOpenPath: (hostPath: string) => void
  onDone: () => void
  onClose: () => void
}): React.ReactElement {
  const run = useRunner(ctx.sessionId)
  const [list, setList] = useState<BackupEntry[] | null>(null)
  const [selected, setSelected] = useState<BackupEntry | null>(null)
  const [manual, setManual] = useState('')
  const [mode, setMode] = useState<'new' | 'overwrite'>(targetVolume ? 'overwrite' : 'new')
  /** null = 还没手动改过,名字跟着选中的备份走。 */
  const [nameEdit, setNameEdit] = useState<string | null>(null)
  /** 打开这个对话框的时刻,用于新卷名后缀(惰性初始化,渲染期不再取当前时间)。 */
  const [stamp] = useState(() => timeStamp())
  const [clearFirst, setClearFirst] = useState(true)
  const [users, setUsers] = useState<VolumeUser[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState('')
  const [done, setDone] = useState('')
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const srcPath = manual.trim() || selected?.path || ''

  // 备份列表
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const a = await run(buildListArchivesCommand(backupDir))
      const s = await run(buildListSidecarsCommand(backupDir))
      if (cancelled) return
      const merged = mergeBackupList(a.stdout, s.stdout)
      setList(merged)
      const preferred = targetVolume
        ? merged.find((e) => e.meta?.volume === targetVolume)
        : merged[0]
      setSelected(preferred ?? merged[0] ?? null)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupDir])

  // 目标卷正被谁用(只有覆盖模式才有意义,但请求本身无害,放 effect 里一次拉完)
  useEffect(() => {
    if (!targetVolume) return
    let cancelled = false
    void run(buildVolumeUsersCommand(ctx.dockerCmd, targetVolume)).then((r) => {
      if (!cancelled && r.code === 0) setUsers(parseVolumeUsers(r.stdout))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVolume])

  // 新卷名是「派生 + 可改」:没手动改过就跟着选中的备份走,不用 effect 去同步 state。
  const defaultNewName = `${targetVolume || selected?.meta?.volume || 'volume'}-restore-${stamp}`
  const newName = nameEdit ?? defaultNewName
  const runningUsers = mode === 'overwrite' ? users.filter(isRunning) : []
  const finalVolume = mode === 'new' ? newName.trim() : (targetVolume ?? '')

  const start = async (): Promise<void> => {
    if (!srcPath || !finalVolume) return
    setRunning(true)
    setFailure('')
    const toStop = mode === 'overwrite' ? runningUsers : []
    const plan: Step[] = [
      { label: '校验备份文件', state: 'pending' },
      ...(toStop.length
        ? [{ label: `停止 ${toStop.length} 个容器`, state: 'pending' as StepState }]
        : []),
      ...(mode === 'new'
        ? [{ label: `创建卷 ${finalVolume}`, state: 'pending' as StepState }]
        : []),
      ...(mode === 'overwrite' && clearFirst
        ? [{ label: '清空目标卷', state: 'pending' as StepState }]
        : []),
      { label: '解包到卷', state: 'pending' },
      ...(toStop.length ? [{ label: '重新启动容器', state: 'pending' as StepState }] : [])
    ]
    setSteps(plan)
    const mark = (i: number, state: StepState, note?: string): void =>
      setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, state, note } : s)))

    let idx = 0
    let stopped = false
    let createdVolume = ''
    try {
      // 1) 校验归档
      mark(idx, 'running')
      const gz = await run(buildVerifyArchiveCommand(srcPath))
      if (!archiveLooksGood(gz.stdout)) {
        const msg = gz.stderr.trim() || gz.stdout.trim() || '文件不可读或不是完整的 gzip 归档'
        mark(idx, 'fail', msg)
        setFailure(`备份文件校验失败:${msg}`)
        return
      }
      mark(idx, 'ok')
      idx++

      // 2) 停容器
      if (toStop.length) {
        mark(idx, 'running')
        const r = await run(
          buildStopCommand(
            ctx.dockerCmd,
            toStop.map((u) => u.id)
          )
        )
        if (r.code !== 0) {
          mark(idx, 'fail', errText(r))
          setFailure(errText(r))
          return
        }
        stopped = true
        mark(idx, 'ok')
        idx++
      }

      // 3) 建卷(新卷模式)
      if (mode === 'new') {
        mark(idx, 'running')
        const r = await run(buildVolumeCreateCommand(ctx.dockerCmd, finalVolume))
        if (r.code !== 0) {
          mark(idx, 'fail', errText(r))
          setFailure(errText(r))
          return
        }
        createdVolume = finalVolume
        mark(idx, 'ok')
        idx++
      }

      // 目标卷的 mountpoint → 决定用直连还是助手容器
      const mpRes = await run(buildVolumeMountpointCommand(ctx.dockerCmd, finalVolume))
      const mountpoint = mpRes.stdout.trim()
      const resolved = await resolveMethod(run, ctx.dockerCmd, finalVolume, mountpoint, backupDir)
      if (!resolved.method) {
        setFailure(resolved.error || '没有可用的解包方式')
        mark(idx, 'fail', resolved.error)
        return
      }
      const method = resolved.method

      // 4) 清空
      if (mode === 'overwrite' && clearFirst) {
        mark(idx, 'running')
        const r = await run(buildClearVolumeCommand(ctx.dockerCmd, method, finalVolume))
        if (r.code !== 0) {
          mark(idx, 'fail', errText(r))
          setFailure(errText(r))
          return
        }
        mark(idx, 'ok')
        idx++
      }

      // 5) 解包
      mark(idx, 'running')
      const { res } = await runWithTarFlags(run, (f) =>
        buildRestoreCommand(ctx.dockerCmd, method, finalVolume, srcPath, f)
      )
      if (res.code !== 0) {
        mark(idx, 'fail', errText(res))
        setFailure(errText(res))
        // 新建的空卷别留着碍事
        if (createdVolume) await run(`${ctx.dockerCmd} volume rm ${createdVolume}`)
        return
      }
      mark(idx, 'ok')
      idx++
      if (alive.current) setDone(finalVolume)
    } finally {
      if (stopped) {
        const i = plan.length - 1
        mark(i, 'running')
        const r = await run(
          buildStartCommand(
            ctx.dockerCmd,
            toStop.map((u) => u.id)
          )
        )
        mark(i, r.code === 0 ? 'ok' : 'fail', r.code === 0 ? undefined : errText(r))
      }
      if (alive.current) setRunning(false)
      onDone()
    }
  }

  const removeBackup = async (e: BackupEntry): Promise<void> => {
    const ok = await window.api.dialog.confirm({
      message: `删除备份 “${e.name}”?`,
      detail: '备份文件与它的元数据会一并删除,不可恢复。',
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (!ok) return
    const r = await run(buildDeleteBackupCommand(e.path))
    if (r.code !== 0) {
      setFailure(errText(r))
      return
    }
    setList((prev) => (prev ?? []).filter((x) => x.path !== e.path))
    if (selected?.path === e.path) setSelected(null)
  }

  return (
    <Shell
      title="从备份还原卷"
      subtitle={targetVolume ? `目标:${targetVolume}` : backupDir}
      busy={running}
      onClose={onClose}
      footer={
        done ? (
          <>
            <button
              onClick={() => onOpenPath(backupDir)}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              <FolderOpen size={13} />
              打开备份目录
            </button>
            <button onClick={onClose} className="btn-primary px-3 py-1.5 text-xs">
              完成
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onClose}
              disabled={running}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              取消
            </button>
            <button
              onClick={() => void start()}
              disabled={running || !srcPath || !finalVolume}
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            >
              <RotateCcw size={13} />
              {running ? '还原中…' : '开始还原'}
            </button>
          </>
        )
      }
    >
      {!list && <div className="text-xs text-[var(--text-muted)]">正在读取备份列表…</div>}
      {list && (
        <>
          <div className="text-xs font-medium text-[var(--text-dark)]">选择备份</div>
          {list.length === 0 && (
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {backupDir} 下没有备份文件。也可以在下面直接填一个 .tar.gz 的完整路径。
            </div>
          )}
          <div className="mt-1.5 flex flex-col gap-1.5">
            {list.map((e) => {
              const active = !manual.trim() && selected?.path === e.path
              return (
                <div
                  key={e.path}
                  className={`flex items-center gap-2 rounded-[var(--radius-sm)] border p-2 ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--panel-border)]'
                  }`}
                >
                  <button
                    onClick={() => {
                      setManual('')
                      setSelected(e)
                    }}
                    disabled={running}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs text-[var(--text-dark)]" title={e.name}>
                      {e.meta?.volume ?? e.name}
                    </div>
                    <div className="truncate text-[10px] text-[var(--text-muted)]">
                      {formatTime(e.mtime)} · {formatBytes(e.fileSize)}
                      {e.meta?.stopped ? ' · 停机备份' : ''}
                      {e.meta ? '' : ' · 无元数据'}
                    </div>
                  </button>
                  <button
                    onClick={() => void removeBackup(e)}
                    disabled={running}
                    title="删除这个备份"
                    className="shrink-0 rounded p-1 text-[var(--danger)] hover:bg-[var(--nav-bg-hover)]"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
          <label className="mt-2 flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">或直接填归档路径</span>
            <input
              className="input w-full font-mono text-xs"
              spellCheck={false}
              placeholder="/path/to/backup.tar.gz"
              value={manual}
              disabled={running}
              onChange={(e) => setManual(e.target.value)}
            />
          </label>

          <div className="mt-3 text-xs font-medium text-[var(--text-dark)]">还原到</div>
          <label className="mt-1 flex items-start gap-2 text-xs text-[var(--text-dark)]">
            <input
              type="radio"
              className="mt-0.5"
              checked={mode === 'new'}
              disabled={running}
              onChange={() => setMode('new')}
            />
            <span className="min-w-0 flex-1">
              新建一个卷(推荐)
              <input
                className="input mt-1 w-full text-xs"
                spellCheck={false}
                value={newName}
                disabled={running || mode !== 'new'}
                onChange={(e) => setNameEdit(e.target.value)}
              />
              <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">
                原卷原封不动;确认数据没问题后,再把容器切到这个新卷。
              </span>
            </span>
          </label>
          {targetVolume && (
            <label className="mt-2 flex items-start gap-2 text-xs text-[var(--text-dark)]">
              <input
                type="radio"
                className="mt-0.5"
                checked={mode === 'overwrite'}
                disabled={running}
                onChange={() => setMode('overwrite')}
              />
              <span className="min-w-0 flex-1">
                覆盖现有卷 <span className="font-mono">{targetVolume}</span>
                <label className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={clearFirst}
                    disabled={running || mode !== 'overwrite'}
                    onChange={(e) => setClearFirst(e.target.checked)}
                  />
                  先清空再还原(不清空则是覆盖合并,旧文件可能残留)
                </label>
              </span>
            </label>
          )}

          {mode === 'overwrite' && runningUsers.length > 0 && (
            <Warn>
              {runningUsers.map((u) => u.name).join('、')} 正在使用这个卷,还原会先把它们停掉,
              完成后自动启动。往运行中的卷里解包会导致数据不一致。
            </Warn>
          )}
          {mode === 'overwrite' && (
            <Warn>覆盖还原会改写卷里现有的数据,且无法撤销。拿不准就用「新建一个卷」。</Warn>
          )}

          {steps.length > 0 && <StepList steps={steps} />}
          {failure && <Danger>{failure}</Danger>}
          {done && (
            <div className="mt-3 rounded-[var(--radius-sm)] bg-green-500/10 p-2.5 text-xs text-green-700">
              已还原到卷 <span className="font-mono">{done}</span>
              {mode === 'new' && '。把容器的挂载改到这个卷即可启用。'}
            </div>
          )}
        </>
      )}
    </Shell>
  )
}
