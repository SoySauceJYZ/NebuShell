import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Monitor,
  MonitorUp,
  Play,
  Square,
  Copy,
  Wifi,
  KeyRound,
  Loader2,
  Link2,
  PowerOff,
  CircleDot
} from 'lucide-react'
import type { RdStartResult } from '@shared/types'
import { AgentHost } from './remoteDesktop/AgentHost'
import { ControllerSession } from './remoteDesktop/ControllerSession'

/**
 * 「远程桌面」页。上半为控制端(输入被控端 IP/端口/访问码发起连接),下半为被控端
 * (一键启动共享服务,显示本机局域网地址与访问码)。发起连接成功后整页切换为画面视图。
 * 第一步:仅局域网直连、仅主屏、仅 Windows 被控。
 */
export function RemoteDesktopView(): React.ReactElement {
  const api = window.api.remoteDesktop

  // 被控端状态
  const [serving, setServing] = useState(false)
  const [startInfo, setStartInfo] = useState<RdStartResult | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const [peerConnected, setPeerConnected] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)

  // 控制端状态
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('46200')
  const [code, setCode] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [session, setSession] = useState<{ rdSessionId: string; target: string } | null>(null)

  // 标签关闭(组件卸载)时若仍在共享,停止被控服务。
  const servingRef = useRef(false)
  useEffect(() => {
    servingRef.current = serving
  }, [serving])
  useEffect(() => {
    return () => {
      if (servingRef.current) window.api.remoteDesktop.stopAgent()
    }
  }, [])

  const startAgent = async (): Promise<void> => {
    setAgentBusy(true)
    setAgentError(null)
    try {
      const info = await api.startAgent()
      setStartInfo(info)
      setServing(true)
    } catch (e) {
      setAgentError(String(e))
    } finally {
      setAgentBusy(false)
    }
  }

  const stopAgent = async (): Promise<void> => {
    setAgentBusy(true)
    try {
      await api.stopAgent()
    } finally {
      setServing(false)
      setStartInfo(null)
      setPeerConnected(false)
      setAgentError(null)
      setAgentBusy(false)
    }
  }

  const connect = async (): Promise<void> => {
    if (!ip.trim()) {
      setConnectError('请输入被控端 IP')
      return
    }
    const rdSessionId = crypto.randomUUID()
    const p = Number(port) || 46200
    setConnecting(true)
    setConnectError(null)
    try {
      await api.connect(rdSessionId, { ip: ip.trim(), port: p, code: code.trim() })
      setSession({ rdSessionId, target: `${ip.trim()}:${p}` })
    } catch (e) {
      setConnectError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setConnecting(false)
    }
  }

  const endSession = useCallback(() => setSession(null), [])
  const copy = (text: string): void => window.api.clipboard.writeText(text)

  return (
    <>
      {/* 被控端逻辑常驻(serving 为 false 时不做任何事),即便正在作为控制端查看画面也保持共享。 */}
      <AgentHost serving={serving} onPeerChange={setPeerConnected} onError={setAgentError} />

      {session ? (
        <div className="flex h-full flex-col bg-black">
          <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2">
            <span className="flex items-center gap-2 text-sm text-[var(--text-dark)]">
              <Monitor size={15} /> 远程桌面 · {session.target}
            </span>
            <button className="btn-secondary" onClick={endSession}>
              <PowerOff size={14} /> 断开
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ControllerSession
              rdSessionId={session.rdSessionId}
              target={session.target}
              onEnd={endSession}
            />
          </div>
        </div>
      ) : (
        <div className="h-full overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-[var(--text-dark)]">远程桌面</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                同一局域网内,控制端输入被控端 IP 与访问码即可实时控制其桌面。第一步仅支持
                Windows 被控端、仅主屏。
              </p>
            </div>

            {/* 控制端 */}
            <section className="card mb-5 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Link2 size={16} className="text-[var(--accent)]" />
                <h3 className="text-sm font-semibold text-[var(--text-dark)]">连接远程桌面</h3>
                <span className="text-xs text-[var(--text-muted)]">(控制端)</span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 min-w-[180px] text-xs text-[var(--text-muted)]">
                  被控端 IP
                  <input
                    className="input mt-1"
                    placeholder="例如 192.168.1.20"
                    value={ip}
                    onChange={(e) => setIp(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && connect()}
                  />
                </label>
                <label className="w-24 text-xs text-[var(--text-muted)]">
                  端口
                  <input
                    className="input mt-1"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && connect()}
                  />
                </label>
                <label className="w-32 text-xs text-[var(--text-muted)]">
                  访问码
                  <input
                    className="input mt-1"
                    placeholder="6 位数字"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && connect()}
                  />
                </label>
                <button className="btn-primary" onClick={connect} disabled={connecting}>
                  {connecting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  连接
                </button>
              </div>
              {connectError && (
                <p className="mt-3 text-xs text-[var(--danger)]">连接失败:{connectError}</p>
              )}
            </section>

            {/* 被控端 */}
            <section className="card p-5">
              <div className="mb-4 flex items-center gap-2">
                <MonitorUp size={16} className="text-[var(--accent)]" />
                <h3 className="text-sm font-semibold text-[var(--text-dark)]">共享我的桌面</h3>
                <span className="text-xs text-[var(--text-muted)]">(被控端)</span>
                {serving && (
                  <span className="ml-auto flex items-center gap-1.5 text-xs">
                    <CircleDot
                      size={12}
                      className={peerConnected ? 'text-emerald-500' : 'text-amber-500'}
                    />
                    {peerConnected ? '控制端已连接' : '等待控制端连接…'}
                  </span>
                )}
              </div>

              {!serving ? (
                <div>
                  <p className="mb-4 text-xs text-[var(--text-muted)]">
                    启动后本机进入被控模式,把下方地址与访问码告诉控制端即可被连接。
                  </p>
                  <button className="btn-primary" onClick={startAgent} disabled={agentBusy}>
                    {agentBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    启动被控端
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Wifi size={13} /> 本机局域网地址
                      </div>
                      <div className="space-y-1">
                        {(startInfo?.ips.length ? startInfo.ips : ['未检测到局域网地址']).map(
                          (addr) => (
                            <div
                              key={addr}
                              className="flex items-center justify-between rounded-md border border-[var(--panel-border)] bg-white px-2.5 py-1.5 text-sm text-[var(--text-dark)]"
                            >
                              <span className="font-mono">
                                {addr}
                                {startInfo && addr !== '未检测到局域网地址'
                                  ? `:${startInfo.port}`
                                  : ''}
                              </span>
                              {startInfo && addr !== '未检测到局域网地址' && (
                                <button
                                  className="text-[var(--text-muted)] hover:text-[var(--accent)]"
                                  title="复制"
                                  onClick={() => copy(`${addr}:${startInfo.port}`)}
                                >
                                  <Copy size={13} />
                                </button>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <KeyRound size={13} /> 访问码
                      </div>
                      <div className="flex items-center justify-between rounded-md border border-[var(--panel-border)] bg-white px-2.5 py-1.5">
                        <span className="font-mono text-lg tracking-widest text-[var(--text-dark)]">
                          {startInfo?.accessCode}
                        </span>
                        <button
                          className="text-[var(--text-muted)] hover:text-[var(--accent)]"
                          title="复制"
                          onClick={() => startInfo && copy(startInfo.accessCode)}
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {agentError && <p className="text-xs text-[var(--danger)]">{agentError}</p>}

                  <button className="btn-secondary" onClick={stopAgent} disabled={agentBusy}>
                    <Square size={14} /> 停止被控端
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  )
}
