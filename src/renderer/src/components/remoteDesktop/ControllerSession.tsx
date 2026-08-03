import { useEffect, useRef, useState } from 'react'
import { MousePointer2, Loader2, AlertTriangle } from 'lucide-react'
import type { RdInputEvent, RdSignal, RdIceCandidate } from '@shared/types'
import { createPeer } from '../../lib/rtc'

interface Props {
  /** 本次连接的会话 id(已通过 remoteDesktop.connect 完成认证)。 */
  rdSessionId: string
  /** 连接对端的展示名,如 192.168.1.20:46200。 */
  target: string
  /** 会话结束(对端断开或出错)时回调,由父组件收尾。 */
  onEnd: () => void
}

/**
 * 控制端画面。作为 WebRTC 应答方:接收被控端的 offer、拿到视频轨渲染到 <video>,
 * 并把本地鼠标/键盘事件经 DataChannel 发回被控端注入。坐标按画面实际显示区域归一化,
 * 兼容 object-fit: contain 的黑边。
 */
export function ControllerSession({ rdSessionId, target, onEnd }: Props): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputChanRef = useRef<RTCDataChannel | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live'>('connecting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const api = window.api.remoteDesktop
    const pc = createPeer()
    let remoteSet = false
    let disposed = false
    const pendingIce: RdIceCandidate[] = []

    pc.onicecandidate = (e): void => {
      if (e.candidate) api.sendSignal(rdSessionId, { kind: 'ice', candidate: e.candidate.toJSON() })
    }
    pc.ontrack = (e): void => {
      if (videoRef.current && e.streams[0]) videoRef.current.srcObject = e.streams[0]
    }
    pc.ondatachannel = (e): void => {
      if (e.channel.label === 'input') inputChanRef.current = e.channel
    }
    pc.onconnectionstatechange = (): void => {
      if (pc.connectionState === 'connected') setStatus('live')
    }

    const offSignal = api.onSignal(rdSessionId, async (signal: RdSignal) => {
      try {
        if (signal.kind === 'offer') {
          await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
          remoteSet = true
          for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {})
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          api.sendSignal(rdSessionId, { kind: 'answer', sdp: answer.sdp ?? '' })
        } else if (signal.kind === 'ice') {
          if (remoteSet) await pc.addIceCandidate(signal.candidate).catch(() => {})
          else pendingIce.push(signal.candidate)
        }
      } catch (err) {
        if (!disposed) setError(String(err))
      }
    })

    const offDisc = api.onPeerDisconnect(rdSessionId, () => {
      if (!disposed) onEnd()
    })

    return (): void => {
      disposed = true
      offSignal()
      offDisc()
      inputChanRef.current = null
      pc.close()
      api.disconnect(rdSessionId)
    }
  }, [rdSessionId, onEnd])

  // ---- 输入捕获 -------------------------------------------------------------
  const send = (ev: RdInputEvent): void => {
    const ch = inputChanRef.current
    if (ch && ch.readyState === 'open') ch.send(JSON.stringify(ev))
  }

  /** 把指针事件换算成画面内容区(去黑边)的归一化坐标;超出内容区返回 null。 */
  const norm = (e: React.PointerEvent): { x: number; y: number } | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth || !v.videoHeight) return null
    const rect = v.getBoundingClientRect()
    const scale = Math.min(rect.width / v.videoWidth, rect.height / v.videoHeight)
    const dispW = v.videoWidth * scale
    const dispH = v.videoHeight * scale
    const offX = (rect.width - dispW) / 2
    const offY = (rect.height - dispH) / 2
    const px = e.clientX - rect.left - offX
    const py = e.clientY - rect.top - offY
    if (px < 0 || py < 0 || px > dispW || py > dispH) return null
    return { x: px / dispW, y: py / dispH }
  }

  return (
    <div
      className="relative flex h-full w-full items-center justify-center bg-black outline-none"
      tabIndex={0}
      onPointerMove={(e) => {
        const p = norm(e)
        if (p) send({ type: 'move', x: p.x, y: p.y })
      }}
      onPointerDown={(e) => {
        ;(e.currentTarget as HTMLDivElement).focus()
        const p = norm(e)
        if (p) send({ type: 'down', x: p.x, y: p.y, button: e.button })
      }}
      onPointerUp={(e) => {
        const p = norm(e)
        if (p) send({ type: 'up', x: p.x, y: p.y, button: e.button })
      }}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => send({ type: 'wheel', dx: e.deltaX, dy: e.deltaY })}
      onKeyDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        send({ type: 'key', down: true, code: e.code })
      }}
      onKeyUp={(e) => {
        e.preventDefault()
        e.stopPropagation()
        send({ type: 'key', down: false, code: e.code })
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full object-contain"
      />
      {status === 'connecting' && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
          <Loader2 size={28} className="animate-spin" />
          <span className="text-sm">正在建立与 {target} 的连接…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[var(--danger)]">
          <AlertTriangle size={28} />
          <span className="max-w-md text-center text-sm">连接出错:{error}</span>
        </div>
      )}
      {status === 'live' && (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-[11px] text-white/80">
          <MousePointer2 size={12} /> 已连接 · 点击画面后可用键盘
        </div>
      )}
    </div>
  )
}
