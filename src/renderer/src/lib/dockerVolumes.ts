// 卷的备份与还原:命令构造与解析。
//
// 两条打包路径,按主机上的实际权限自动选:
//  - direct:直接 tar 卷的 mountpoint(/var/lib/docker/volumes/<名>/_data)。最快、不依赖
//    任何镜像,但那个目录是 root:root 0700,需要 root 或免密 sudo。
//  - helper:起一个一次性容器 `docker run --rm -v 卷:/from:ro <镜像> tar ...`。普通用户
//    也能用,代价是主机上得有一个自带 tar 的镜像(优先挑**用这个卷的那个容器**的镜像 ——
//    它一定在本地,也几乎一定有 tar;再不行找 alpine/busybox 之类)。
//
// 两条路径都把 tar **写到 stdout 再由用户的 shell 重定向**成文件,而不是让容器往挂进去的
// 宿主目录里写:这样产物归当前用户所有(不会出现一堆删不掉的 root 文件),也少挂一个卷。
//
// tar 一律尝试带 `--numeric-owner`:不保数字 uid/gid 的话,mysql 这类以 uid 999 运行的卷
// 还原回去会全变成 root,数据库直接起不来 —— 这是「备份成功、还原失败」最常见的原因。

import type { ImageInfo } from './dockerContainers'

/** 备份默认落在主机上这个目录(用户家目录下,备份产物归用户自己)。 */
export const DEFAULT_BACKUP_DIR = '~/docker-volume-backups'

/** 边车元数据文件的后缀,列备份时据此识别「本程序做的备份」。 */
export const SIDECAR_SUFFIX = '.nebu-backup.json'
export const ARCHIVE_SUFFIX = '.tar.gz'

/** 为 shell 安全地单引号包裹。 */
function q(v: string): string {
  return /^[\w@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`
}

/**
 * 远端路径 → shell 表达式。`~/x` 要交给远端 shell 展开,而整串加引号会让 `~` 失效,
 * 所以这里把家目录部分写成 "$HOME" 再和引号化的其余部分拼接。
 */
export function pathExpr(p: string): string {
  const trimmed = p.trim().replace(/\/+$/, '') || '/'
  if (trimmed === '~') return '"$HOME"'
  if (trimmed.startsWith('~/')) return `"$HOME"/${q(trimmed.slice(2))}`
  return q(trimmed)
}

/** 目录 + 文件名 → 远端路径表达式。 */
export function joinExpr(dir: string, name: string): string {
  return `${pathExpr(dir)}/${q(name)}`
}

/** docker 前缀是 'sudo -n docker' 时,直接读 mountpoint 也要带同样的 sudo。 */
export function sudoPrefix(dockerCmd: string): string {
  return dockerCmd.trim().startsWith('sudo') ? 'sudo -n ' : ''
}

/** 20260911-1530,用于备份文件名与还原时的新卷名。 */
export function timeStamp(at: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`
}

/** 备份文件名:卷名-20260911-1530。 */
export function backupBaseName(volume: string, at: Date = new Date()): string {
  // 文件名里只留安全字符,卷名本身可能含 '/'(极少)或空格。
  const safe = volume.replace(/[^\w.-]+/g, '_')
  return `${safe}-${timeStamp(at)}`
}

// ---- 用到这个卷的容器 -------------------------------------------------------

export interface VolumeUser {
  id: string
  name: string
  state: string
  image: string
}

export function buildVolumeUsersCommand(dockerCmd: string, volume: string): string {
  return (
    `${dockerCmd} ps -a --filter volume=${q(volume)} --format ` +
    `'{{.ID}}\\t{{.Names}}\\t{{.State}}\\t{{.Image}}'`
  )
}

export function parseVolumeUsers(out: string): VolumeUser[] {
  const items: VolumeUser[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    if (!f[0]) continue
    items.push({ id: f[0], name: f[1] ?? '', state: (f[2] ?? '').toLowerCase(), image: f[3] ?? '' })
  }
  return items
}

export const isRunning = (u: VolumeUser): boolean => u.state === 'running' || u.state === 'paused'

// ---- 预检:能不能直接读 mountpoint、卷多大、目标盘还剩多少 -------------------

export interface AccessProbe {
  /** 能直接读卷目录(root / 免密 sudo)。 */
  direct: boolean
  /** 卷大小(字节,未压缩);量不出来为 null。 */
  sizeBytes: number | null
  /** 备份目录所在分区可用空间(字节);量不出来为 null。 */
  freeBytes: number | null
}

/**
 * 一次往返拿齐:目标目录可否创建、剩余空间、卷目录可否直读、(可直读时)卷有多大。
 * du 用 -sk(POSIX,KB)而不是 GNU 专有的 -sb,busybox 的 du 也认。
 */
export function buildAccessProbeCommand(
  dockerCmd: string,
  mountpoint: string,
  backupDir: string
): string {
  const sudo = sudoPrefix(dockerCmd)
  const dir = pathExpr(backupDir)
  const mp = q(mountpoint)
  return [
    `mkdir -p ${dir} 2>/dev/null`,
    `echo "FREE:$(df -Pk ${dir} 2>/dev/null | awk 'NR==2{print $4}')"`,
    `if ${sudo}ls -A ${mp} >/dev/null 2>&1; then`,
    `  echo DIRECT:1`,
    `  echo "SIZE:$(${sudo}du -sk ${mp} 2>/dev/null | awk '{print $1}')"`,
    `else echo DIRECT:0; fi`
  ].join('\n')
}

function kbToBytes(v: string | undefined): number | null {
  const n = Number((v ?? '').trim())
  return Number.isFinite(n) && n >= 0 ? n * 1024 : null
}

export function parseAccessProbe(out: string): AccessProbe {
  const free = out.match(/FREE:(\d+)/)?.[1]
  const size = out.match(/SIZE:(\d+)/)?.[1]
  return {
    direct: /DIRECT:1/.test(out),
    sizeBytes: kbToBytes(size),
    freeBytes: kbToBytes(free)
  }
}

// ---- 助手镜像 ---------------------------------------------------------------

/** 常见的、自带 tar 的小镜像,按优先级。 */
const FALLBACK_IMAGES = [/^alpine(:|$)/, /^busybox(:|$)/, /^debian(:|$)/, /^ubuntu(:|$)/]

/**
 * 挑一个能用来打包的镜像:先用「正在用这个卷的容器」的镜像(一定在本地,
 * 且和卷里的数据同源),否则从本地镜像里找常见的小镜像。
 */
export function pickHelperImage(users: VolumeUser[], images: ImageInfo[]): string | null {
  const fromUser = users.find((u) => u.image && !u.image.startsWith('sha256:'))?.image
  if (fromUser) return fromUser
  const tagged = images.filter((i) => !i.dangling).map((i) => `${i.repository}:${i.tag}`)
  for (const re of FALLBACK_IMAGES) {
    const hit = tagged.find((t) => re.test(t))
    if (hit) return hit
  }
  return null
}

/** 验证该镜像里确实有 tar(distroless 之类没有)。 */
export function buildHelperProbeCommand(dockerCmd: string, image: string): string {
  return `${dockerCmd} run --rm --entrypoint sh ${q(image)} -c 'command -v tar >/dev/null && echo TAR_OK'`
}

export const helperHasTar = (out: string): boolean => /TAR_OK/.test(out)

/** 助手容器里量卷大小(KB)。 */
export function buildHelperSizeCommand(dockerCmd: string, image: string, volume: string): string {
  return `${dockerCmd} run --rm --entrypoint du -v ${q(volume)}:/from:ro ${q(image)} -sk /from`
}

export function parseHelperSize(out: string): number | null {
  return kbToBytes(out.trim().split(/\s+/)[0])
}

// ---- 打包方式 ---------------------------------------------------------------

export type PackMethod = { kind: 'direct'; mountpoint: string } | { kind: 'helper'; image: string }

export function describeMethod(m: PackMethod): string {
  return m.kind === 'direct'
    ? '直接打包宿主机上的卷目录(最快,不依赖镜像)'
    : `用一次性容器打包(镜像 ${m.image})`
}

/**
 * tar 参数阶梯:从「保数字属主 + 扩展属性」逐级降级。busybox tar 不认这些长选项,
 * 报错里会带 unrecognized/invalid option,此时退一级重试,而不是当成失败。
 */
export const TAR_FLAG_LADDER: string[][] = [
  ['--numeric-owner', '--xattrs'],
  ['--numeric-owner'],
  []
]

export function isUnsupportedFlagError(stderr: string): boolean {
  return /unrecognized option|invalid option|unknown option|unrecognized:|not supported/i.test(
    stderr
  )
}

// ---- 备份 -------------------------------------------------------------------

/**
 * 备份命令。tar 走 stdout,由 shell 重定向成文件(产物归当前用户);中途失败就把
 * 半截文件删掉再以非零退出,避免留下一个「看着像备份」的残片。
 */
export function buildBackupCommand(
  dockerCmd: string,
  method: PackMethod,
  volume: string,
  destExpr: string,
  flags: string[]
): string {
  const f = flags.join(' ')
  const producer =
    method.kind === 'direct'
      ? `${sudoPrefix(dockerCmd)}tar -cz ${f} -C ${q(method.mountpoint)} .`
      : `${dockerCmd} run --rm --entrypoint tar -v ${q(volume)}:/from:ro ${q(method.image)} -cz ${f} -C /from .`
  return `{ ${producer} > ${destExpr} || { rm -f ${destExpr}; false; }; }`
}

/** 备份产物旁边的元数据(单行 JSON)。 */
export interface BackupMeta {
  v: 1
  volume: string
  host: string
  createdAt: string
  /** 卷原始大小(字节),量不到为 null。 */
  sizeBytes: number | null
  method: 'direct' | 'helper'
  image?: string
  tarFlags: string[]
  /** 备份时用到这个卷的容器名。 */
  users: string[]
  /** 备份时是否停过这些容器。 */
  stopped: boolean
}

export function buildSidecarCommand(sidecarExpr: string, meta: BackupMeta): string {
  // JSON 里只有双引号,单引号包裹即可安全写入;printf '%s' 避免 echo 对反斜杠的方言差异。
  return `printf '%s' ${q(JSON.stringify(meta))} > ${sidecarExpr}`
}

/** 轮询已写入的字节数(进度条用)。 */
export function buildSizeProbeCommand(destExpr: string): string {
  return `stat -c %s ${destExpr} 2>/dev/null || echo 0`
}

// ---- 备份列表 ---------------------------------------------------------------

export interface BackupEntry {
  /** 远端完整路径。 */
  path: string
  name: string
  fileSize: number
  /** 文件修改时间(毫秒)。 */
  mtime: number
  meta?: BackupMeta
}

export function buildListArchivesCommand(backupDir: string): string {
  const dir = pathExpr(backupDir)
  return [
    `for t in ${dir}/*${ARCHIVE_SUFFIX}; do`,
    `  [ -f "$t" ] || continue`,
    `  printf '%s\\t%s\\t%s\\n' "$t" "$(stat -c %s "$t" 2>/dev/null || echo 0)" "$(stat -c %Y "$t" 2>/dev/null || echo 0)"`,
    `done`
  ].join('\n')
}

export function buildListSidecarsCommand(backupDir: string): string {
  const dir = pathExpr(backupDir)
  return [
    `for j in ${dir}/*${SIDECAR_SUFFIX}; do`,
    `  [ -f "$j" ] || continue`,
    `  printf '%s\\t' "$j"`,
    `  tr -d '\\n' < "$j"`,
    `  printf '\\n'`,
    `done`
  ].join('\n')
}

/** 合并「有哪些 .tar.gz」与「有哪些边车 json」,按文件名对应。 */
export function mergeBackupList(archivesOut: string, sidecarsOut: string): BackupEntry[] {
  const metaByBase = new Map<string, BackupMeta>()
  for (const line of sidecarsOut.split('\n')) {
    if (!line.trim()) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const jsonPath = line.slice(0, tab)
    const base = baseNameOf(jsonPath).slice(0, -SIDECAR_SUFFIX.length)
    try {
      const meta = JSON.parse(line.slice(tab + 1)) as BackupMeta
      if (meta && typeof meta === 'object') metaByBase.set(base, meta)
    } catch {
      // 边车坏了不影响列出归档本身
    }
  }
  const items: BackupEntry[] = []
  for (const line of archivesOut.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    if (!f[0]) continue
    const name = baseNameOf(f[0])
    const base = name.slice(0, -ARCHIVE_SUFFIX.length)
    items.push({
      path: f[0],
      name,
      fileSize: Number(f[1]) || 0,
      mtime: (Number(f[2]) || 0) * 1000,
      meta: metaByBase.get(base)
    })
  }
  // 新的排前面
  return items.sort((a, b) => b.mtime - a.mtime)
}

function baseNameOf(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

export function buildDeleteBackupCommand(archivePath: string): string {
  const base = archivePath.slice(0, -ARCHIVE_SUFFIX.length)
  return `rm -f ${q(archivePath)} ${q(base + SIDECAR_SUFFIX)}`
}

// ---- 还原 -------------------------------------------------------------------

export function buildVolumeCreateCommand(dockerCmd: string, name: string): string {
  return `${dockerCmd} volume create ${q(name)}`
}

export function buildVolumeMountpointCommand(dockerCmd: string, name: string): string {
  return `${dockerCmd} volume inspect -f '{{.Mountpoint}}' ${q(name)}`
}

/** 覆盖还原前清空目标卷。 */
export function buildClearVolumeCommand(
  dockerCmd: string,
  method: PackMethod,
  volume: string
): string {
  if (method.kind === 'direct') {
    return `${sudoPrefix(dockerCmd)}find ${q(method.mountpoint)} -mindepth 1 -delete`
  }
  return (
    `${dockerCmd} run --rm --entrypoint sh -v ${q(volume)}:/to ${q(method.image)} ` +
    `-c 'find /to -mindepth 1 -delete 2>/dev/null || rm -rf /to/..?* /to/.[!.]* /to/*'`
  )
}

/** 还原:把归档解到目标卷里。 */
export function buildRestoreCommand(
  dockerCmd: string,
  method: PackMethod,
  volume: string,
  srcPath: string,
  flags: string[]
): string {
  const f = flags.join(' ')
  const src = q(srcPath)
  if (method.kind === 'direct') {
    return `${sudoPrefix(dockerCmd)}tar -xz ${f} -C ${q(method.mountpoint)} < ${src}`
  }
  return (
    `${dockerCmd} run --rm -i --entrypoint tar -v ${q(volume)}:/to ${q(method.image)} ` +
    `-xz ${f} -C /to < ${src}`
  )
}

/** 归档是否可读、是不是完好的 gzip(还原前先验一下,别解到一半才发现)。 */
export function buildVerifyArchiveCommand(srcPath: string): string {
  return `gzip -t ${q(srcPath)} 2>&1 && echo GZ_OK`
}

export const archiveLooksGood = (out: string): boolean => /GZ_OK/.test(out)

export function buildStopCommand(dockerCmd: string, ids: string[]): string {
  return `${dockerCmd} stop ${ids.join(' ')}`
}

export function buildStartCommand(dockerCmd: string, ids: string[]): string {
  return `${dockerCmd} start ${ids.join(' ')}`
}

// ---- 显示 -------------------------------------------------------------------

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function formatTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
