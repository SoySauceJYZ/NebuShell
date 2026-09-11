// 容器列表的轮询器:**每台主机一份**,而不是每个面板一份。
//
// 面板本体在 SplitLayout 里是常驻挂载的(切走的 tab 只是 display:none),过去每个打开过
// 容器面板的终端都在自己每 4 秒跑一次 `docker ps -a` —— 同一台主机开三个 tab 就是三倍,
// 而且切到别的 tab 之后仍在跑。现在:同主机的订阅者共用一份轮询,并且在**没有任何订阅者
// 可见**(tab 切走、窗口最小化)时整个暂停,重新可见时立刻补一次。
import {
  buildPsCommand,
  buildStatsCommand,
  parsePsOutput,
  parseStatsOutput,
  type ContainerInfo
} from './dockerContainers'
import { mapDockerError } from '@shared/dockerErrors'
import { useDockerStore } from '../store/useDockerStore'

const POLL_MS = 4000
/** 资源占用比列表贵,隔一轮采一次。 */
const STATS_EVERY = 2
/** 运行中的容器太多时不采 stats:docker stats 会明显拖慢主机。 */
const STATS_MAX_CONTAINERS = 40

interface Sub {
  sessionId: string
  dockerCmd: string
  visible: boolean
}

interface HostPoll {
  subs: Map<string, Sub>
  timer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  tick: number
  /** 上一次写进 store 的列表签名,内容没变就不再 setState(避免无谓重渲染)。 */
  signature: string
}

const hosts = new Map<string, HostPoll>()

function anyVisible(h: HostPoll): boolean {
  if (document.hidden) return false
  for (const s of h.subs.values()) if (s.visible) return true
  return false
}

/** 优先用可见订阅者的会话执行命令(它的终端多半是活的)。 */
function pickSub(h: HostPoll): Sub | null {
  let fallback: Sub | null = null
  for (const s of h.subs.values()) {
    if (s.visible) return s
    fallback ??= s
  }
  return fallback
}

function signatureOf(list: ContainerInfo[]): string {
  return list.map((c) => `${c.id}|${c.state}|${c.status}|${c.ports}|${c.name}`).join('\n')
}

function schedule(hostId: string): void {
  const h = hosts.get(hostId)
  if (!h) return
  if (h.timer) clearTimeout(h.timer)
  h.timer = null
  if (!anyVisible(h)) return // 全部不可见 → 暂停轮询
  h.timer = setTimeout(() => void poll(hostId), POLL_MS)
}

async function poll(hostId: string): Promise<void> {
  const h = hosts.get(hostId)
  if (!h || h.inFlight) return
  const sub = pickSub(h)
  if (!sub) return
  h.inFlight = true
  const { setData } = useDockerStore.getState()
  try {
    const res = await window.api.ssh.execFull(sub.sessionId, buildPsCommand(sub.dockerCmd))
    if (res.code !== 0) {
      setData(hostId, { error: mapDockerError(res.stderr || res.stdout) })
    } else {
      const list = parsePsOutput(res.stdout)
      const sig = signatureOf(list)
      // 内容没变就只清错误,不替换数组 —— 卡片不会每 4 秒重渲染一次。
      if (sig !== h.signature) {
        h.signature = sig
        setData(hostId, { containers: list, error: '' })
      } else if (useDockerStore.getState().dataByHost[hostId]?.error) {
        setData(hostId, { error: '' })
      }

      const running = list.filter((c) => c.state === 'running').length
      const statsOn =
        useDockerStore.getState().statsEnabled && running > 0 && running <= STATS_MAX_CONTAINERS
      if (statsOn && h.tick % STATS_EVERY === 0) {
        const st = await window.api.ssh.execFull(sub.sessionId, buildStatsCommand(sub.dockerCmd))
        // stats 失败不当成面板级错误(容器可能刚好在这一瞬退出),静默跳过这一轮。
        if (st.code === 0) setData(hostId, { stats: parseStatsOutput(st.stdout) })
      } else if (
        !statsOn &&
        Object.keys(useDockerStore.getState().dataByHost[hostId]?.stats ?? {}).length
      ) {
        // 关掉采集(或已无运行中的容器)时把旧数字清掉,免得卡片上留一屏定格的占用。
        setData(hostId, { stats: {} })
      }
    }
  } catch (err) {
    setData(hostId, { error: err instanceof Error ? err.message : String(err) })
  } finally {
    h.tick++
    h.inFlight = false
    schedule(hostId)
  }
}

/** 立刻跑一轮(打开面板、做完动作、点刷新)。 */
export function refreshNow(hostId: string): void {
  const h = hosts.get(hostId)
  if (!h) return
  if (h.timer) clearTimeout(h.timer)
  h.timer = null
  void poll(hostId)
}

/** 登记一个订阅者(一个面板)。返回注销函数。 */
export function subscribe(
  hostId: string,
  subId: string,
  sessionId: string,
  dockerCmd: string
): () => void {
  let h = hosts.get(hostId)
  if (!h) {
    h = { subs: new Map(), timer: null, inFlight: false, tick: 0, signature: '' }
    hosts.set(hostId, h)
  }
  h.subs.set(subId, { sessionId, dockerCmd, visible: true })
  refreshNow(hostId)
  return () => {
    const cur = hosts.get(hostId)
    if (!cur) return
    cur.subs.delete(subId)
    if (cur.subs.size === 0) {
      if (cur.timer) clearTimeout(cur.timer)
      hosts.delete(hostId)
    } else {
      schedule(hostId)
    }
  }
}

/** 面板是否正被看见(tab 在前台且窗口没最小化)。不可见的订阅者不驱动轮询。 */
export function setVisible(hostId: string, subId: string, visible: boolean): void {
  const h = hosts.get(hostId)
  const sub = h?.subs.get(subId)
  if (!h || !sub || sub.visible === visible) return
  sub.visible = visible
  // 重新可见:立刻补一轮,避免看到一屏过期状态。
  if (visible && anyVisible(h)) refreshNow(hostId)
  else schedule(hostId)
}

// 窗口整体隐藏/恢复:一次性暂停或唤醒所有主机的轮询。
document.addEventListener('visibilitychange', () => {
  for (const hostId of hosts.keys()) {
    if (document.hidden) schedule(hostId)
    else refreshNow(hostId)
  }
})
