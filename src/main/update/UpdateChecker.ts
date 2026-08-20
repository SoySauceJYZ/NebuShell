import { app } from 'electron'
import { UPDATE_GITHUB_REPO, type UpdateAsset, type UpdateInfo } from '../../shared/types'

const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_GITHUB_REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${UPDATE_GITHUB_REPO}/releases`
const TIMEOUT_MS = 10_000

/** GitHub Releases API 里我们用到的字段。 */
interface GithubAsset {
  name: string
  size: number
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string
  assets: GithubAsset[]
}

// 各平台可下载的安装包后缀,按优先级排列(electron-builder.yml 里配置的产物在前)。
const PLATFORM_EXTENSIONS: Record<string, string[]> = {
  win32: ['.exe', '.msi', '.zip'],
  darwin: ['.dmg', '.pkg', '.zip'],
  linux: ['.appimage', '.deb', '.rpm', '.snap']
}

// 资源名里可能出现的架构写法。
const ARCH_ALIASES: Record<string, string[]> = {
  x64: ['x64', 'x86_64', 'amd64'],
  arm64: ['arm64', 'aarch64']
}

/** 去掉 tag 里的 v 前缀与空白,得到纯版本号。 */
export function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^v/i, '')
}

/** 语义化版本比较:a 新于 b 返回正数,旧于 b 返回负数,相同返回 0。 */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA = ''] = normalizeVersion(a).split('-')
  const [coreB, preB = ''] = normalizeVersion(b).split('-')
  const partsA = coreA.split('.').map((n) => parseInt(n, 10) || 0)
  const partsB = coreB.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (diff !== 0) return diff
  }
  // 主体版本相同时,带预发布后缀的(1.4.0-beta)比正式版(1.4.0)旧。
  if (preA === preB) return 0
  if (!preA) return 1
  if (!preB) return -1
  return preA < preB ? -1 : 1
}

/** 从 release 资源里挑出与当前平台/架构匹配的安装包。 */
export function pickAsset(
  assets: GithubAsset[],
  platform: string,
  arch: string
): UpdateAsset | null {
  // electron-builder 还会上传 .blockmap / latest*.yml 这类更新元数据,不是给人下载的。
  const candidates = assets.filter(
    (a) => !a.name.endsWith('.blockmap') && !/^latest.*\.ya?ml$/i.test(a.name)
  )
  const aliases = ARCH_ALIASES[arch] ?? [arch]
  const foreign = Object.entries(ARCH_ALIASES)
    .filter(([key]) => key !== arch)
    .flatMap(([, tags]) => tags)
    .filter((tag) => !aliases.includes(tag))

  for (const ext of PLATFORM_EXTENSIONS[platform] ?? []) {
    const matches = candidates.filter((a) => a.name.toLowerCase().endsWith(ext))
    if (matches.length === 0) continue
    // 同一后缀有多个产物时:先挑架构对得上的,再退到没标架构的通用包
    // (别把 mac 的 arm64 包塞给 x64),最后才退回第一个。
    const chosen =
      matches.find((a) => aliases.some((tag) => a.name.toLowerCase().includes(tag))) ??
      matches.find((a) => !foreign.some((tag) => a.name.toLowerCase().includes(tag))) ??
      matches[0]
    return { name: chosen.name, url: chosen.browser_download_url, size: chosen.size }
  }
  return null
}

// 最近一次成功的检查结果,供新开的窗口/设置页直接复用,避免重复请求 GitHub。
let lastResult: UpdateInfo | null = null

export function getCachedUpdate(): UpdateInfo | null {
  return lastResult
}

/** 向 GitHub 查询最新 Release,并与当前版本比较。失败时抛出可直接展示的中文错误。 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `NebuShell/${currentVersion}`
      },
      signal: controller.signal
    })
  } catch (err) {
    if (controller.signal.aborted) throw new Error('检查更新超时,请稍后重试')
    throw new Error(`无法连接 GitHub:${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 404) throw new Error('仓库还没有发布任何版本')
  if (res.status === 403 || res.status === 429)
    throw new Error('GitHub 接口访问频率超限,请稍后重试')
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status} ${res.statusText}`)

  const release = (await res.json()) as GithubRelease
  const latestVersion = normalizeVersion(release.tag_name ?? '')
  if (!latestVersion) throw new Error('GitHub 返回的发布信息里没有版本号')

  const info: UpdateInfo = {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: release.html_url || RELEASES_PAGE,
    releaseName: release.name || release.tag_name,
    notes: release.body ?? '',
    publishedAt: release.published_at ?? '',
    asset: pickAsset(release.assets ?? [], process.platform, process.arch),
    checkedAt: Date.now()
  }
  lastResult = info
  return info
}
