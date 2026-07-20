import type { SshConnectOptions, TransferPlan, TransferProgress } from '@shared/types'
import type { TransferKind } from './agentPermissions'
import { targetKind, type AgentTarget } from './agentTools'
import { resolveConnectOptions } from './resolveConnectOptions'
import { useVaultStore } from '../store/useVaultStore'
import { useTransfersStore } from '../store/useTransfersStore'
import { baseName } from './pathUtils'

/** 支持的传输路线。其余组合底层没有对应 API,见 resolveRoute。 */
export type TransferRoute =
  'local->ssh' | 'ssh->local' | 'ssh->ssh' | 'local->container' | 'container->local'

export type RouteResult =
  { ok: true; route: TransferRoute; kind: TransferKind } | { ok: false; reason: string }

/**
 * 路线矩阵。容器 ↔ SSH、容器 ↔ 容器没有直传 API(containerFs 只做本机 ↔ 容器),
 * 本机 ↔ 本机则交给 run_command —— 两种情况都返回可直接喂给模型的说明。
 */
export function resolveRoute(src: AgentTarget, dst: AgentTarget): RouteResult {
  const s = targetKind(src)
  const d = targetKind(dst)
  if (s === 'local' && d === 'ssh') return { ok: true, route: 'local->ssh', kind: 'upload' }
  if (s === 'ssh' && d === 'local') return { ok: true, route: 'ssh->local', kind: 'download' }
  if (s === 'ssh' && d === 'ssh') return { ok: true, route: 'ssh->ssh', kind: 'upload' }
  if (s === 'local' && d === 'container') {
    return { ok: true, route: 'local->container', kind: 'upload' }
  }
  if (s === 'container' && d === 'local') {
    return { ok: true, route: 'container->local', kind: 'download' }
  }
  if (s === 'local' && d === 'local') {
    return {
      ok: false,
      reason:
        '本机内部的复制不支持用 transfer_file,请改用 run_command 执行 cp(Windows 用 Copy-Item)。'
    }
  }
  return {
    ok: false,
    reason:
      `不支持在「${src.name}」和「${dst.name}」之间直接传输` +
      '(容器与 SSH 主机之间、两个容器之间没有直传通道)。' +
      '请分两步:先传到本机,再从本机传到目标。'
  }
}

// ---- 智能体自己的文件会话 --------------------------------------------------
// 独立命名空间:不能复用 `${sessionId}::sftp`,那一路归 RemotePane 所有,
// 用户切换右侧面板 tab 就会在 unmount 时把它断掉。

const sftpSessionId = (t: AgentTarget): string => `${t.sessionId}::agentfs`
const cfsSessionId = (t: AgentTarget): string => `${t.sessionId}::agentcfs`

/**
 * 已建连的会话 id。SftpManager 既没有 isConnected,重复 connect 又会直接覆盖
 * map 条目而不 end 旧 client(静默泄漏一条连接),所以这层记账必须在渲染进程做。
 */
const connected = new Set<string>()

/** 该目标的连接参数(主机 + 凭据),缺主机信息时抛出可直接展示的错误。 */
function connectOptionsFor(t: AgentTarget, sid: string): SshConnectOptions {
  const { hosts, credentials } = useVaultStore.getState()
  const host = hosts.find((h) => h.id === t.hostId)
  if (!host) throw new Error(`目标「${t.name}」缺少主机信息,无法建立文件传输连接`)
  return resolveConnectOptions(sid, host, credentials)
}

async function connectSftp(t: AgentTarget): Promise<string> {
  const sid = sftpSessionId(t)
  if (connected.has(sid)) return sid
  await window.api.sftp.connect(connectOptionsFor(t, sid))
  connected.add(sid)
  return sid
}

async function connectContainerFs(t: AgentTarget): Promise<string> {
  const sid = cfsSessionId(t)
  if (connected.has(sid)) return sid
  if (!t.containerId) throw new Error(`目标「${t.name}」不是容器终端`)
  await window.api.containerFs.connect({
    ...connectOptionsFor(t, sid),
    containerId: t.containerId,
    dockerCmd: t.dockerCmd ?? 'docker'
  })
  connected.add(sid)
  return sid
}

/** 建立(或复用)该目标的智能体文件会话,返回会话 id。本机目标不需要会话。 */
export async function ensureAgentFs(t: AgentTarget): Promise<string> {
  return targetKind(t) === 'container' ? connectContainerFs(t) : connectSftp(t)
}

async function dropSession(t: AgentTarget): Promise<void> {
  const kind = targetKind(t)
  const sid = kind === 'container' ? cfsSessionId(t) : sftpSessionId(t)
  connected.delete(sid)
  try {
    if (kind === 'container') await window.api.containerFs.disconnect(sid)
    else await window.api.sftp.disconnect(sid)
  } catch {
    // 会话可能本来就没了 —— 目的只是清账,失败无所谓。
  }
}

/**
 * 终端关闭时释放它名下的智能体文件会话(由 TerminalTab 的 unmount 调用)。
 * 会话生命周期跟着终端走,而不是跟着智能体面板走 —— 同一个终端可能被多个
 * 智能体面板当作 target。
 */
export function releaseAgentFs(terminalSessionId: string): void {
  for (const sid of [`${terminalSessionId}::agentfs`, `${terminalSessionId}::agentcfs`]) {
    if (!connected.has(sid)) continue
    connected.delete(sid)
    const isCfs = sid.endsWith('::agentcfs')
    void (isCfs ? window.api.containerFs.disconnect(sid) : window.api.sftp.disconnect(sid)).catch(
      () => {}
    )
  }
}

/**
 * 连接已经死掉的迹象。SftpManager 在 TCP 断开后并不清理 map 条目,所以第一次
 * 调用拿到的是一条死连接,报的是 ssh2 的原始错误而不是 'SFTP session not found'。
 */
function looksDisconnected(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /session not found|not connected|no response from server|channel open failure|ECONNRESET|EPIPE|closed/i.test(
    msg
  )
}

// ---- Dry run ---------------------------------------------------------------

/**
 * 确认卡片用的预扫描:这次传输会搬多少文件、多少字节。
 * 容器作为源时返回 null(未知)—— 容器内递归扫描要逐层 `ls` 解析,往返代价高。
 */
export async function planTransfer(
  src: AgentTarget,
  srcPath: string
): Promise<TransferPlan | null> {
  const kind = targetKind(src)
  if (kind === 'local') return window.api.local.planPaths([srcPath])
  if (kind === 'container') return null
  try {
    const sid = await connectSftp(src)
    return await window.api.sftp.planPath(sid, srcPath)
  } catch (err) {
    if (!looksDisconnected(err)) throw err
    await dropSession(src)
    const sid = await connectSftp(src)
    return window.api.sftp.planPath(sid, srcPath)
  }
}

// ---- 执行 ------------------------------------------------------------------

export interface TransferOutcome {
  ok: boolean
  doneFiles: number
  doneBytes: number
  totalFiles: number
  totalBytes: number
  /** 出错时:进度流里最后处理到的路径,用来指出是哪个文件挂了。 */
  lastPath?: string
  error?: string
  elapsedMs: number
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 按路线调用对应的传输 API。 */
async function invokeRoute(
  route: TransferRoute,
  src: AgentTarget,
  srcPath: string,
  dst: AgentTarget,
  dstPath: string,
  transferId: string
): Promise<void> {
  switch (route) {
    case 'local->ssh':
      return window.api.sftp.uploadPaths(await connectSftp(dst), dstPath, [srcPath], transferId)
    case 'ssh->local':
      return window.api.sftp.downloadTo(await connectSftp(src), srcPath, dstPath, transferId)
    case 'ssh->ssh':
      return window.api.sftp.transfer(
        await connectSftp(src),
        srcPath,
        await connectSftp(dst),
        dstPath,
        transferId
      )
    case 'local->container':
      return window.api.containerFs.uploadPaths(
        await connectContainerFs(dst),
        dstPath,
        [srcPath],
        transferId
      )
    case 'container->local':
      return window.api.containerFs.downloadTo(
        await connectContainerFs(src),
        srcPath,
        dstPath,
        transferId
      )
  }
}

/** 该路线上哪一端持有会话(重连时要丢弃的是它)。 */
function sessionSide(route: TransferRoute, src: AgentTarget, dst: AgentTarget): AgentTarget[] {
  switch (route) {
    case 'local->ssh':
    case 'local->container':
      return [dst]
    case 'ssh->local':
    case 'container->local':
      return [src]
    case 'ssh->ssh':
      return [src, dst]
  }
}

/**
 * 跑一次传输:登记到传输记录面板、订阅进度、失败时按需重连重试一次。
 *
 * 重试只在「一个字节都还没搬」时进行 —— 传到一半再重来会从头覆盖,
 * 而这里唯一想救的场景是 SftpManager 留下的死连接(第一次调用必然立刻失败)。
 */
export async function runAgentTransfer(opts: {
  src: AgentTarget
  srcPath: string
  dst: AgentTarget
  dstPath: string
  route: TransferRoute
  ownerId: string
  onProgress?: (p: TransferProgress) => void
}): Promise<TransferOutcome> {
  const { src, srcPath, dst, dstPath, route, ownerId, onProgress } = opts
  const startedAt = Date.now()
  const transferId = genId()
  const label = `${baseName(srcPath)} → ${dst.name}`

  // track() 内部才订阅进度,必须早于实际调用,否则丢掉开头的事件。
  useTransfersStore.getState().track(transferId, label, ownerId)

  let last: TransferProgress | undefined
  const unsub = window.api.transfers.onProgress(transferId, (p) => {
    last = p
    onProgress?.(p)
  })

  const moved = (): boolean => (last?.doneBytes ?? 0) > 0 || (last?.doneFiles ?? 0) > 0

  try {
    try {
      await invokeRoute(route, src, srcPath, dst, dstPath, transferId)
    } catch (err) {
      if (!looksDisconnected(err) || moved()) throw err
      for (const t of sessionSide(route, src, dst)) await dropSession(t)
      await invokeRoute(route, src, srcPath, dst, dstPath, transferId)
    }
    return {
      ok: true,
      doneFiles: last?.doneFiles ?? 0,
      doneBytes: last?.doneBytes ?? 0,
      totalFiles: last?.totalFiles ?? 0,
      totalBytes: last?.totalBytes ?? 0,
      elapsedMs: Date.now() - startedAt
    }
  } catch (err) {
    return {
      ok: false,
      doneFiles: last?.doneFiles ?? 0,
      doneBytes: last?.doneBytes ?? 0,
      totalFiles: last?.totalFiles ?? 0,
      totalBytes: last?.totalBytes ?? 0,
      lastPath: last?.currentPath,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - startedAt
    }
  } finally {
    unsub()
  }
}

// ---- 展示 ------------------------------------------------------------------

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 回给模型的结果文案。短、事实性,不走 #ref 分页那套(那是 exitCode 语义)。 */
export function describeOutcome(
  o: TransferOutcome,
  src: AgentTarget,
  srcPath: string,
  dst: AgentTarget,
  dstPath: string
): string {
  const route = `${src.name} ${srcPath} → ${dst.name} ${dstPath}`
  if (o.ok) {
    const secs = (o.elapsedMs / 1000).toFixed(1)
    return `[传输完成] ${route} · ${o.doneFiles} 个文件 · ${formatBytes(o.doneBytes)} · ${secs}s`
  }
  const parts = [`[传输失败] ${route}`]
  if (o.totalFiles > 0) {
    parts.push(
      `已完成 ${o.doneFiles}/${o.totalFiles} 个文件(${formatBytes(o.doneBytes)}/${formatBytes(o.totalBytes)})`
    )
  }
  parts.push(`错误: ${o.error ?? '未知错误'}`)
  if (o.lastPath) parts.push(`最后处理: ${o.lastPath}`)
  if (o.doneFiles > 0 || o.doneBytes > 0) {
    parts.push('注意:目标端已有部分文件,最后一个文件可能不完整;重试会从头覆盖')
  }
  return parts.join(' · ')
}
