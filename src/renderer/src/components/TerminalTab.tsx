import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RotateCw } from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { useTerminalStore } from '../store/useTerminalStore'
import { useSessionStore } from '../store/useSessionStore'
import { resolveConnectOptions } from '../lib/resolveConnectOptions'
import { extractCommandFromLine } from '../lib/parseCommandLine'
import { getTheme, DEFAULT_THEME_ID } from '../lib/terminalThemes'
import { DEFAULT_FONT_SIZE } from '../store/useTerminalStore'
import { TerminalRightPanel } from './TerminalRightPanel'
import { TerminalContextMenu } from './TerminalContextMenu'

function truncateTitle(text: string): string {
  const firstLine = text.split('\n')[0].trim()
  return firstLine.length > 24 ? firstLine.slice(0, 24) + '…' : firstLine
}

type Status = 'connecting' | 'connected' | 'error' | 'closed'

export function TerminalTab({
  sessionId,
  hostId
}: {
  sessionId: string
  hostId: string
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const selectionRef = useRef('')
  const statusRef = useRef<Status>('connecting')
  const reconnectingRef = useRef(false)
  const doConnectRef = useRef<() => void>(() => {})
  const [status, setStatus] = useState<Status>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const hosts = useVaultStore((s) => s.hosts)
  const credentials = useVaultStore((s) => s.credentials)
  const addCommand = useTerminalStore((s) => s.addCommand)
  const openTab = useSessionStore((s) => s.openTab)
  const themeId = useTerminalStore((s) => s.themeBySession[sessionId])
  const preset = getTheme(themeId ?? DEFAULT_THEME_ID)
  const fontSize = useTerminalStore((s) => s.fontSizeBySession[sessionId] ?? DEFAULT_FONT_SIZE)

  statusRef.current = status

  // (Re)establish the SSH connection for this session. Callable again to reconnect.
  const doConnect = useCallback(() => {
    const host = hosts.find((h) => h.id === hostId)
    const term = termRef.current
    if (!host || !term) return
    reconnectingRef.current = true
    setStatus('connecting')
    setErrorMsg('')
    // Clean up any lingering session for this id before reconnecting.
    window.api.ssh.disconnect(sessionId)
    term.write('\r\n\x1b[36m[正在连接...]\x1b[0m\r\n')
    const opts = resolveConnectOptions(sessionId, host, credentials)
    window.api.ssh
      .connect(opts)
      .then(() => {
        reconnectingRef.current = false
        setStatus('connected')
        try {
          fitRef.current?.fit()
          window.api.ssh.resize(sessionId, term.cols, term.rows)
        } catch {
          // ignore
        }
      })
      .catch((err) => {
        reconnectingRef.current = false
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
  }, [sessionId, hostId, hosts, credentials])

  useEffect(() => {
    doConnectRef.current = doConnect
  }, [doConnect])

  useEffect(() => {
    if (!containerRef.current) return

    const initial = getTheme(
      useTerminalStore.getState().themeBySession[sessionId] ?? DEFAULT_THEME_ID
    )
    const term = new Terminal({
      cursorBlink: true,
      fontSize: useTerminalStore.getState().fontSizeBySession[sessionId] ?? DEFAULT_FONT_SIZE,
      fontFamily: 'Consolas, "Courier New", "Microsoft YaHei", "微软雅黑", monospace',
      theme: initial.theme
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term
    fitRef.current = fitAddon

    const unsubData = window.api.ssh.onData(sessionId, (data) => {
      term.write(data)
    })
    const unsubClosed = window.api.ssh.onClosed(sessionId, () => {
      if (reconnectingRef.current) return
      setStatus('closed')
      term.write('\r\n\x1b[33m[连接已关闭] 按回车重新连接\x1b[0m\r\n')
    })
    const unsubError = window.api.ssh.onError(sessionId, (message) => {
      if (reconnectingRef.current) return
      setStatus('error')
      setErrorMsg(message)
      term.write(`\r\n\x1b[31m[连接错误] ${message}\x1b[0m\r\n`)
    })

    const dataDisposable = term.onData((data) => {
      // While disconnected (closed/error), Enter triggers a reconnect; other input
      // is ignored. During the initial 'connecting' phase, input is just dropped.
      if (statusRef.current !== 'connected') {
        if (
          (statusRef.current === 'closed' || statusRef.current === 'error') &&
          data.includes('\r')
        ) {
          doConnectRef.current()
        }
        return
      }
      window.api.ssh.write(sessionId, data)
      if (term.hasSelection()) term.clearSelection()
      if (data.includes('\r')) {
        const buf = term.buffer.active
        const line = buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? ''
        const cmd = extractCommandFromLine(line)
        if (cmd) addCommand(sessionId, cmd)
      }
    })

    doConnectRef.current()

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        window.api.ssh.resize(sessionId, term.cols, term.rows)
      } catch {
        // ignore resize race during teardown
      }
    })
    resizeObserver.observe(containerRef.current)

    const selectionDisposable = term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (selection) window.api.clipboard.writeText(selection)
    })

    const paste = (): void => {
      const text = window.api.clipboard.readText()
      if (text) term.paste(text)
    }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey) {
        if (e.code === 'KeyV') {
          paste()
          return false
        }
        if (e.code === 'KeyC') {
          const selection = term.getSelection()
          if (selection) window.api.clipboard.writeText(selection)
          return false
        }
      }
      return true
    })

    const el = containerRef.current
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button === 1) {
        e.preventDefault()
        paste()
      }
    }
    el.addEventListener('mousedown', onMouseDown)

    // Reconnect requested from the tab's right-click menu.
    const onReconnectEvent = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === sessionId) doConnectRef.current()
    }
    window.addEventListener('ssh-reconnect', onReconnectEvent)

    return () => {
      resizeObserver.disconnect()
      dataDisposable.dispose()
      selectionDisposable.dispose()
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('ssh-reconnect', onReconnectEvent)
      unsubData()
      unsubClosed()
      unsubError()
      window.api.ssh.disconnect(sessionId)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hostId])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = preset.theme
  }, [preset])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    try {
      fitRef.current?.fit()
      window.api.ssh.resize(sessionId, term.cols, term.rows)
    } catch {
      // ignore fit race during teardown
    }
  }, [fontSize, sessionId])

  const handleContextCapture = (e: React.MouseEvent): void => {
    const selection = termRef.current?.getSelection() ?? ''
    if (!selection) {
      e.preventDefault()
      e.stopPropagation()
      const text = window.api.clipboard.readText()
      if (text) termRef.current?.paste(text)
    } else {
      selectionRef.current = selection
    }
  }

  const onCopy = (): void => {
    if (selectionRef.current) window.api.clipboard.writeText(selectionRef.current)
  }
  const onPaste = (): void => {
    const text = window.api.clipboard.readText()
    if (text) termRef.current?.paste(text)
  }
  const onEdit = (): void => {
    const sel = selectionRef.current
    if (!sel) return
    openTab({
      id: `editor-${Date.now()}`,
      kind: 'editor',
      title: `编辑: ${truncateTitle(sel)}`,
      editorContent: sel,
      editorLang: 'plaintext'
    })
  }
  const onEditResult = (): void => {
    const sel = selectionRef.current.trim()
    if (!sel) return
    openTab({
      id: `editor-${Date.now()}`,
      kind: 'editor',
      title: `结果: ${truncateTitle(sel)}`,
      editorExecCommand: sel,
      editorSourceSessionId: sessionId,
      editorLang: 'plaintext'
    })
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: preset.wrapperBg }}>
        {status !== 'connected' && (
          <div
            className={`flex items-center gap-2 px-4 py-1 text-xs ${
              status === 'error'
                ? 'bg-red-900/60 text-red-200'
                : status === 'closed'
                  ? 'bg-yellow-900/50 text-yellow-200'
                  : 'bg-blue-900/50 text-blue-200'
            }`}
          >
            <span className="flex-1">
              {status === 'connecting' && '正在连接...'}
              {status === 'error' && `连接失败: ${errorMsg}`}
              {status === 'closed' && '连接已关闭'}
            </span>
            {status !== 'connecting' && (
              <button
                onClick={() => doConnect()}
                className="flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 hover:bg-white/25"
              >
                <RotateCw size={11} />
                重新连接
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1" onContextMenuCapture={handleContextCapture}>
          <TerminalContextMenu
            onCopy={onCopy}
            onPaste={onPaste}
            onEdit={onEdit}
            onEditResult={onEditResult}
          >
            <div ref={containerRef} className="h-full px-2 py-1" />
          </TerminalContextMenu>
        </div>
      </div>
      <TerminalRightPanel sessionId={sessionId} hostId={hostId} connected={status === 'connected'} />
    </div>
  )
}
