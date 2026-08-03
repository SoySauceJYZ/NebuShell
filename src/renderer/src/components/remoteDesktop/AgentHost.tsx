import { useEffect } from 'react'
import type { RdSignal, RdIceCandidate, RdInputEvent } from '@shared/types'
import { createPeer } from '../../lib/rtc'

interface Props {
  /** 被控端服务是否已启动。false 时本组件不做任何事。 */
  serving: boolean
  /** 控制端接入 / 断开时上报,供父组件显示状态。 */
  onPeerChange: (connected: boolean) => void
  /** 采屏或建流失败时上报错误文案。 */
  onError: (message: string | null) => void
}

/**
 * 被控端主机逻辑(无独立可视 UI)。作为 WebRTC 发起方:控制端接入后采集主屏、把视频轨
 * 推给对端,并创建 input DataChannel 接收控制端的鼠标/键盘事件,转交 main 用 nut.js 注入。
 * 第一步为 1:1——同一时刻只服务一个控制端。
 */
export function AgentHost({ serving, onPeerChange, onError }: Props): null {
  useEffect(() => {
    if (!serving) return
    const api = window.api.remoteDesktop

    let current: {
      pc: RTCPeerConnection
      stream?: MediaStream
      offSignal: () => void
      offDisc: () => void
    } | null = null

    const teardown = (): void => {
      if (!current) return
      current.offSignal()
      current.offDisc()
      current.stream?.getTracks().forEach((t) => t.stop())
      current.pc.close()
      current = null
    }

    const startPeer = async (rdSessionId: string): Promise<void> => {
      teardown()
      onError(null)
      const pc = createPeer()
      let remoteSet = false
      const pendingIce: RdIceCandidate[] = []

      pc.onicecandidate = (e): void => {
        if (e.candidate)
          api.sendSignal(rdSessionId, { kind: 'ice', candidate: e.candidate.toJSON() })
      }

      // 采集主屏为 MediaStream(Electron 桌面采集用旧式 chromeMediaSource 约束,免弹窗)。
      const src = await api.getScreenSource()
      if (!src) {
        onError('无法获取屏幕采集源')
        pc.close()
        return
      }
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: src.id
          }
        }
      } as unknown as MediaStreamConstraints
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (err) {
        onError('屏幕采集失败:' + String(err))
        pc.close()
        return
      }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))

      // 输入通道:控制端在此通道上发来输入事件,转交 main 注入到真实桌面。
      const channel = pc.createDataChannel('input')
      channel.onmessage = (ev): void => {
        try {
          api.injectInput(JSON.parse(ev.data) as RdInputEvent)
        } catch {
          /* ignore malformed */
        }
      }

      const offSignal = api.onSignal(rdSessionId, async (signal: RdSignal) => {
        try {
          if (signal.kind === 'answer') {
            await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
            remoteSet = true
            for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {})
          } else if (signal.kind === 'ice') {
            if (remoteSet) await pc.addIceCandidate(signal.candidate).catch(() => {})
            else pendingIce.push(signal.candidate)
          }
        } catch (err) {
          onError(String(err))
        }
      })
      const offDisc = api.onPeerDisconnect(rdSessionId, () => {
        teardown()
        onPeerChange(false)
      })

      current = { pc, stream, offSignal, offDisc }
      onPeerChange(true)

      // 作为发起方创建并发送 offer。
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      api.sendSignal(rdSessionId, { kind: 'offer', sdp: offer.sdp ?? '' })
    }

    const offPeer = api.onAgentPeer((rdSessionId: string) => {
      startPeer(rdSessionId).catch((e) => onError(String(e)))
    })

    return (): void => {
      offPeer()
      teardown()
      onPeerChange(false)
    }
  }, [serving, onPeerChange, onError])

  return null
}
