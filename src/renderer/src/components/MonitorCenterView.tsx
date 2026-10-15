import { useEffect, useRef } from 'react'
import { mount, unmount, resume, TEMPLATE } from '../monitorCenter/legacy/app.js'
import wastelandCss from '../monitorCenter/legacy/css/wasteland.css?inline'
import pipboyCss from '../monitorCenter/legacy/css/pipboy.css?inline'
import extraCss from '../monitorCenter/legacy/css/extra.css?inline'
import { useSessionStore } from '../store/useSessionStore'

const RENEW_MS = 20000
/** 切走后保留采集的时长:来回切标签页时不必反复断开、重连 SSH。 */
const HIDE_GRACE_MS = 60000

/**
 * 监控中心(GRID-WATCH)。界面是 resource-monitor 原生 JS 前端的原样移植,
 * 放进 Shadow DOM 里,与 NebuShell 的 Tailwind 样式互不影响。
 * 只有模块真正显示在屏幕上时才持有采集租约;标签页切到后台或窗口最小化超过
 * HIDE_GRACE_MS 即释放,主进程随之停止采集。
 */
export function MonitorCenterView(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `<style>${wastelandCss}\n${pipboyCss}\n${extraCss}</style><div class="gw-root crt">${TEMPLATE}</div>`
    mount(shadow, {
      openHosts: () =>
        useSessionStore.getState().openTab({ id: 'hosts', kind: 'hosts', title: '主机' })
    })

    const mc = window.api.monitorCenter
    let leaseId: string | null = null
    let acquiring = false
    let disposed = false
    let shown = false
    let releaseTimer: ReturnType<typeof setTimeout> | null = null

    const isShown = (): boolean =>
      document.visibilityState !== 'hidden' &&
      (host.offsetParent !== null ||
        document.fullscreenElement === host ||
        host.classList.contains('gw-pseudo-fs'))

    const acquire = (): void => {
      if (leaseId || acquiring || disposed) return
      acquiring = true
      mc.acquire()
        .then((id) => {
          acquiring = false
          if (disposed || !shown) void mc.release(id)
          else leaseId = id
        })
        .catch(() => {
          acquiring = false
        })
    }
    const release = (): void => {
      if (!leaseId) return
      void mc.release(leaseId).catch(() => undefined)
      leaseId = null
    }

    const update = (): void => {
      const now = isShown()
      if (now === shown) return
      shown = now
      if (now) {
        if (releaseTimer) clearTimeout(releaseTimer)
        releaseTimer = null
        acquire()
        resume()
      } else if (!releaseTimer) {
        releaseTimer = setTimeout(() => {
          releaseTimer = null
          if (!shown) release()
        }, HIDE_GRACE_MS)
      }
    }

    // display:none 的切换(标签页前后台)会触发 IntersectionObserver
    const io = new IntersectionObserver(update)
    io.observe(host)
    document.addEventListener('visibilitychange', update)
    document.addEventListener('fullscreenchange', update)
    update()

    const renew = setInterval(() => {
      if (leaseId) void mc.renew(leaseId).catch(() => undefined)
    }, RENEW_MS)

    return () => {
      disposed = true
      io.disconnect()
      document.removeEventListener('visibilitychange', update)
      document.removeEventListener('fullscreenchange', update)
      clearInterval(renew)
      if (releaseTimer) clearTimeout(releaseTimer)
      release()
      unmount()
      shadow.innerHTML = ''
    }
  }, [])

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-[#0a0805]" />
}
