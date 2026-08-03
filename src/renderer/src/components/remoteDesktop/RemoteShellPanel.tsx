import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ShellMsg } from '../../lib/rdChannels'

/**
 * 控制端的远程命令行面板。经 shell DataChannel 与被控端的 node-pty 终端对接:xterm 的按键
 * 发过去,pty 的输出写回 xterm。顶部可切 PowerShell / cmd(切换即重启远端会话)。
 */
export function RemoteShellPanel({ channel }: { channel: RTCDataChannel | null }): React.ReactElement {
  const [shell, setShell] = useState<'powershell' | 'cmd'>('powershell')
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(channel)
  channelRef.current = channel

  const sendShell = useCallback((msg: ShellMsg): void => {
    const ch = channelRef.current
    if (ch && ch.readyState === 'open') ch.send(JSON.stringify(msg))
  }, [])

  // 建终端(仅一次)。
  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", "Microsoft YaHei", "微软雅黑", monospace',
      theme: { background: '#0a0a0b', foreground: '#ededf0' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    try {
      fit.fit()
    } catch {
      /* not laid out yet */
    }
    termRef.current = term
    fitRef.current = fit

    const onData = term.onData((d) => sendShell({ t: 'input', data: d }))
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        sendShell({ t: 'resize', cols: term.cols, rows: term.rows })
      } catch {
        /* ignore */
      }
    })
    ro.observe(containerRef.current)

    return () => {
      onData.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sendShell])

  // 绑定频道 + 启动/重启远端 shell(频道就绪或切换 shell 类型时)。
  useEffect(() => {
    const ch = channel
    const term = termRef.current
    if (!ch || !term) return

    const start = (): void => {
      term.reset()
      sendShell({ t: 'start', shell, cols: term.cols || 80, rows: term.rows || 24 })
    }
    const onMessage = (ev: MessageEvent): void => {
      let msg: ShellMsg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.t === 'data') term.write(msg.data)
      else if (msg.t === 'exit')
        term.write(`\r\n\x1b[33m[会话已结束 code=${msg.code}]\x1b[0m\r\n`)
    }

    ch.addEventListener('message', onMessage)
    if (ch.readyState === 'open') start()
    else ch.addEventListener('open', start, { once: true })

    return () => {
      ch.removeEventListener('message', onMessage)
      ch.removeEventListener('open', start)
      if (ch.readyState === 'open') {
        try {
          ch.send(JSON.stringify({ t: 'stop' } satisfies ShellMsg))
        } catch {
          /* ignore */
        }
      }
    }
  }, [channel, shell, sendShell])

  const tabBtn = (id: 'powershell' | 'cmd', label: string): React.ReactElement => (
    <button
      onClick={() => setShell(id)}
      className={`rounded px-2 py-0.5 text-[11px] transition ${
        shell === id
          ? 'bg-[var(--accent)] text-white'
          : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--panel-border)] px-2 py-1.5">
        <span className="mr-1 text-xs font-medium text-[var(--text-dark)]">远程命令行</span>
        {tabBtn('powershell', 'PowerShell')}
        {tabBtn('cmd', 'CMD')}
        {!channel && <span className="ml-auto text-[10px] text-[var(--text-muted)]">连接中…</span>}
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 bg-[#0a0a0b] p-1" />
    </div>
  )
}
