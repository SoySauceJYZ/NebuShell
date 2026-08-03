import { useEffect } from 'react'
import type { RdSignal, RdIceCandidate, RdInputEvent, RdScreen } from '@shared/types'
import { createPeer } from '../../lib/rtc'
import { ClipboardSync, FileReceiver, sendControl, type ControlMsg } from '../../lib/rdChannels'

interface Props {
  /** 被控端服务是否已启动。false 时本组件不做任何事。 */
  serving: boolean
  /** 控制端接入 / 断开时上报,供父组件显示状态。 */
  onPeerChange: (connected: boolean) => void
  /** 采屏或建流失败时上报错误文案。 */
  onError: (message: string | null) => void
  /** 收到并存好一个文件时上报(文件名 + 落盘路径),供父组件展示。 */
  onFileReceived: (name: string, path: string) => void
}

/** 桌面采集流(旧式 chromeMediaSource 约束,Electron 免弹窗)。 */
function captureScreen(sourceId: string): Promise<MediaStream> {
  const constraints = {
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
  } as unknown as MediaStreamConstraints
  return navigator.mediaDevices.getUserMedia(constraints)
}

/**
 * 被控端主机逻辑(无独立可视 UI)。作为 WebRTC 发起方:控制端接入后采集显示器、推视频轨,
 * 并建立 input / control / file 三条 DataChannel——分别承载鼠标键盘、控制消息(显示器切换、
 * 剪贴板)、文件传输。第一步为 1:1。
 */
export function AgentHost({ serving, onPeerChange, onError, onFileReceived }: Props): null {
  useEffect(() => {
    if (!serving) return
    const api = window.api.remoteDesktop

    let current: {
      pc: RTCPeerConnection
      stream?: MediaStream
      sender?: RTCRtpSender
      offSignal: () => void
      offDisc: () => void
      clipboard: ClipboardSync
    } | null = null

    const teardown = (): void => {
      if (!current) return
      current.offSignal()
      current.offDisc()
      current.clipboard.stop()
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
      let screens: RdScreen[] = []
      let activeSourceId = ''

      pc.onicecandidate = (e): void => {
        if (e.candidate)
          api.sendSignal(rdSessionId, { kind: 'ice', candidate: e.candidate.toJSON() })
      }

      // 枚举显示器,默认采主屏(无主屏标记则取第一块)。
      try {
        screens = await api.listScreens()
      } catch {
        screens = []
      }
      if (screens.length === 0) {
        onError('无法获取屏幕采集源')
        pc.close()
        return
      }
      const primary = screens.find((s) => s.primary) ?? screens[0]
      activeSourceId = primary.sourceId
      await api.setActiveDisplay(primary.displayId)

      let stream: MediaStream
      try {
        stream = await captureScreen(primary.sourceId)
      } catch (err) {
        onError('屏幕采集失败:' + String(err))
        pc.close()
        return
      }
      const sender = pc.addTrack(stream.getVideoTracks()[0], stream)

      // input 频道:控制端发来的鼠标/键盘,转交 main 注入。
      const inputCh = pc.createDataChannel('input')
      inputCh.onmessage = (ev): void => {
        try {
          api.injectInput(JSON.parse(ev.data) as RdInputEvent)
        } catch {
          /* ignore */
        }
      }

      // control 频道:显示器列表/切换、剪贴板同步。
      const controlCh = pc.createDataChannel('control')
      const clipboard = new ClipboardSync((text) => sendControl(controlCh, { t: 'clipboard', text }))
      controlCh.onopen = (): void => {
        sendControl(controlCh, { t: 'screens', screens, active: activeSourceId })
        clipboard.start()
      }
      controlCh.onmessage = async (ev): Promise<void> => {
        let msg: ControlMsg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (msg.t === 'clipboard') {
          clipboard.applyRemote(msg.text)
        } else if (msg.t === 'switchDisplay') {
          const scr = screens.find((s) => s.sourceId === msg.sourceId)
          if (!scr || !current) return
          try {
            const next = await captureScreen(scr.sourceId)
            await current.sender?.replaceTrack(next.getVideoTracks()[0])
            current.stream?.getTracks().forEach((t) => t.stop())
            current.stream = next
            activeSourceId = scr.sourceId
            await api.setActiveDisplay(scr.displayId)
            sendControl(controlCh, { t: 'screens', screens, active: activeSourceId })
          } catch (err) {
            onError('切换显示器失败:' + String(err))
          }
        }
      }

      // file 频道:接收控制端推送的文件,落盘到「下载」。
      const fileCh = pc.createDataChannel('file')
      fileCh.binaryType = 'arraybuffer'
      const receiver = new FileReceiver(
        () => {},
        async (name, data) => {
          try {
            const path = await api.saveIncomingFile(name, data)
            onFileReceived(name, path)
            sendControl(controlCh, { t: 'file-done', name })
          } catch (err) {
            onError('保存文件失败:' + String(err))
          }
        }
      )
      fileCh.onmessage = (ev): void => receiver.handle(ev.data)

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

      current = { pc, stream, sender, offSignal, offDisc, clipboard }
      onPeerChange(true)

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
  }, [serving, onPeerChange, onError, onFileReceived])

  return null
}
