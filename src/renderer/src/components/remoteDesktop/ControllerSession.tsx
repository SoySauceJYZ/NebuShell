import { useEffect, useRef, useState } from 'react'
import { MousePointer2, Loader2, AlertTriangle, Monitor, Upload, Check } from 'lucide-react'
import type { RdInputEvent, RdSignal, RdIceCandidate, RdScreen } from '@shared/types'
import { createPeer } from '../../lib/rtc'
import { ClipboardSync, sendControl, sendFile, type ControlMsg } from '../../lib/rdChannels'

interface Props {
  /** 本次连接的会话 id(已通过 remoteDesktop.connect 完成认证)。 */
  rdSessionId: string
  /** 连接对端的展示名,如 192.168.1.20:46200。 */
  target: string
  /** 会话结束(对端断开或出错)时回调,由父组件收尾。 */
  onEnd: () => void
}

interface FileProgress {
  name: string
  sent: number
  total: number
  saved: boolean
}

/**
 * 控制端画面。作为 WebRTC 应答方:接收被控端 offer、渲染视频轨,并把本地鼠标/键盘经
 * input 频道发回;control 频道承载显示器切换与剪贴板同步,file 频道向被控端推送文件。
 */
export function ControllerSession({ rdSessionId, target, onEnd }: Props): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputChanRef = useRef<RTCDataChannel | null>(null)
  const controlChanRef = useRef<RTCDataChannel | null>(null)
  const fileChanRef = useRef<RTCDataChannel | null>(null)

  const [status, setStatus] = useState<'connecting' | 'live'>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [screens, setScreens] = useState<RdScreen[]>([])
  const [activeSource, setActiveSource] = useState('')
  const [fileProgress, setFileProgress] = useState<FileProgress | null>(null)
  /** 右侧面板当前打开的分页(null 为收起)。 */
  const [panelTab, setPanelTab] = useState<'displays' | 'file' | null>(null)

  useEffect(() => {
    const api = window.api.remoteDesktop
    const pc = createPeer()
    let remoteSet = false
    let disposed = false
    const pendingIce: RdIceCandidate[] = []
    const clipboard = new ClipboardSync((text) =>
      sendControl(controlChanRef.current, { t: 'clipboard', text })
    )

    pc.onicecandidate = (e): void => {
      if (e.candidate) api.sendSignal(rdSessionId, { kind: 'ice', candidate: e.candidate.toJSON() })
    }
    pc.ontrack = (e): void => {
      if (videoRef.current && e.streams[0]) videoRef.current.srcObject = e.streams[0]
    }
    pc.onconnectionstatechange = (): void => {
      if (pc.connectionState === 'connected') setStatus('live')
    }
    pc.ondatachannel = (e): void => {
      const ch = e.channel
      if (ch.label === 'input') {
        inputChanRef.current = ch
      } else if (ch.label === 'control') {
        controlChanRef.current = ch
        ch.onopen = (): void => clipboard.start()
        ch.onmessage = (ev): void => {
          let msg: ControlMsg
          try {
            msg = JSON.parse(ev.data)
          } catch {
            return
          }
          if (msg.t === 'screens') {
            setScreens(msg.screens)
            setActiveSource(msg.active)
          } else if (msg.t === 'clipboard') {
            clipboard.applyRemote(msg.text)
          } else if (msg.t === 'file-done') {
            setFileProgress((p) => (p ? { ...p, saved: true } : null))
            window.setTimeout(() => !disposed && setFileProgress(null), 2000)
          }
        }
      } else if (ch.label === 'file') {
        ch.binaryType = 'arraybuffer'
        fileChanRef.current = ch
      }
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
      clipboard.stop()
      inputChanRef.current = null
      controlChanRef.current = null
      fileChanRef.current = null
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

  const switchDisplay = (sourceId: string): void => {
    sendControl(controlChanRef.current, { t: 'switchDisplay', sourceId })
  }

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const ch = fileChanRef.current
    if (!file || !ch || ch.readyState !== 'open') return
    setFileProgress({ name: file.name, sent: 0, total: file.size, saved: false })
    try {
      await sendFile(ch, file, (sent, total) =>
        setFileProgress({ name: file.name, sent, total, saved: false })
      )
    } catch (err) {
      setError('文件发送失败:' + String(err))
      setFileProgress(null)
    }
  }

  const toggle = (tab: 'displays' | 'file'): void =>
    setPanelTab((cur) => (cur === tab ? null : tab))
  const pct = fileProgress
    ? Math.floor((fileProgress.sent / Math.max(1, fileProgress.total)) * 100)
    : 0

  const RAIL = [
    { id: 'displays' as const, label: '显示器', icon: Monitor },
    { id: 'file' as const, label: '发送文件', icon: Upload }
  ]

  return (
    <div className="flex h-full w-full flex-col bg-[var(--content-bg)]">
      {/* 画面区 + 右侧面板 + 右侧图标栏 */}
      <div className="flex min-h-0 flex-1">
        {/* 画面 + 输入捕获层 */}
        <div className="relative min-w-0 flex-1 bg-black">
          <div
            className="absolute inset-0 flex items-center justify-center outline-none"
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
          </div>

          {status === 'connecting' && !error && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-sm">正在建立与 {target} 的连接…</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-x-0 top-3 z-20 mx-auto flex max-w-md items-center justify-center gap-2 rounded-md bg-[var(--danger)]/90 px-3 py-2 text-sm text-white">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
        </div>

        {/* 右侧面板(展开时) */}
        {panelTab && (
          <div className="flex w-64 flex-col border-l border-[var(--panel-border)] bg-[var(--panel-bg)]">
            {panelTab === 'displays' && (
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[var(--text-dark)]">
                  <Monitor size={15} /> 显示器
                </div>
                {screens.length <= 1 ? (
                  <p className="text-xs text-[var(--text-muted)]">远程仅一块显示器。</p>
                ) : (
                  <div className="space-y-1">
                    {screens.map((s) => (
                      <button
                        key={s.sourceId}
                        onClick={() => switchDisplay(s.sourceId)}
                        className={`flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left text-xs transition ${
                          s.sourceId === activeSource
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                            : 'border-[var(--panel-border)] bg-white text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]'
                        }`}
                      >
                        <span>{s.name}</span>
                        <span className="text-[10px] opacity-70">
                          {s.width}×{s.height}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {panelTab === 'file' && (
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[var(--text-dark)]">
                  <Upload size={15} /> 发送文件
                </div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">
                  文件将保存到远程电脑的「下载」目录。
                </p>
                <button className="btn-primary" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} /> 选择文件
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={pickFile} />
                {fileProgress && (
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                      <span className="truncate">{fileProgress.name}</span>
                      {fileProgress.saved ? (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <Check size={12} /> 已保存
                        </span>
                      ) : (
                        <span>{pct}%</span>
                      )}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded bg-[var(--nav-bg-hover)]">
                      <div
                        className="h-full bg-[var(--accent)] transition-[width]"
                        style={{ width: `${fileProgress.saved ? 100 : pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 右侧图标栏(预留菜单,后续可加更多功能) */}
        <div className="flex w-11 flex-col items-center gap-1 border-l border-[var(--panel-border)] bg-[var(--nav-bg)] py-2">
          {RAIL.map((item) => {
            const Icon = item.icon
            const active = panelTab === item.id
            return (
              <button
                key={item.id}
                title={item.label}
                onClick={() => toggle(item.id)}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                  active
                    ? 'bg-[var(--nav-active-bg)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]'
                }`}
              >
                <Icon size={18} strokeWidth={1.75} />
              </button>
            )
          })}
        </div>
      </div>

      {/* 底部状态栏(留出下方空间) */}
      <div className="flex h-8 items-center gap-2 border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[11px] text-[var(--text-muted)]">
        <MousePointer2 size={12} />
        {status === 'live' ? (
          <span>已连接 {target} · 点击画面后可用键盘 · 剪贴板自动同步</span>
        ) : (
          <span>正在连接 {target}…</span>
        )}
      </div>
    </div>
  )
}
