import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RotateCw } from 'lucide-react'
import { useVaultStore } from '../store/useVaultStore'
import { useTerminalStore } from '../store/useTerminalStore'
import { useCommandHistoryStore } from '../store/useCommandHistoryStore'
import { useSessionStore } from '../store/useSessionStore'
import { resolveConnectOptions } from '../lib/resolveConnectOptions'
import { extractCommandFromLine } from '../lib/parseCommandLine'
import { getTheme, DEFAULT_THEME_ID } from '../lib/terminalThemes'
import { DEFAULT_FONT_SIZE } from '../store/useTerminalStore'
import { TerminalRightPanel } from './TerminalRightPanel'
import { TerminalContextMenu } from './TerminalContextMenu'
import { CommandPalette } from './CommandPalette'

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
  // Triple-tap Ctrl detection: timestamps of "pure" Ctrl taps, and whether the current
  // Ctrl press was consumed as a modifier (e.g. Ctrl+C) so it doesn't count as a tap.
  const ctrlTapsRef = useRef<number[]>([])
  const ctrlUsedRef = useRef(false)
  const [status, setStatus] = useState<Status>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const hosts = useVaultStore((s) => s.hosts)
  const credentials = useVaultStore((s) => s.credentials)
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
        if (cmd) useCommandHistoryStore.getState().add(hostId, cmd, 'user')
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

    // Triple-tap Ctrl (3 pure Ctrl presses within 600ms) opens the command palette.
    // Capture phase so we see the keys before xterm's own handlers on the textarea.
    const TAP_WINDOW = 600
    const onKeyDownCapture = (e: KeyboardEvent): void => {
      if (e.key === 'Control') {
        if (!e.repeat) ctrlUsedRef.current = false
      } else {
        // any other key marks the held Ctrl as "used" (a modifier, not a tap)
        ctrlUsedRef.current = true
      }
    }
    const onKeyUpCapture = (e: KeyboardEvent): void => {
      if (e.key !== 'Control') return
      if (ctrlUsedRef.current) {
        ctrlUsedRef.current = false
        return
      }
      const now = Date.now()
      const taps = ctrlTapsRef.current.filter((t) => now - t < TAP_WINDOW)
      taps.push(now)
      if (taps.length >= 3) {
        ctrlTapsRef.current = []
        setPaletteOpen(true)
      } else {
        ctrlTapsRef.current = taps
      }
    }
    el.addEventListener('keydown', onKeyDownCapture, true)
    el.addEventListener('keyup', onKeyUpCapture, true)

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
      el.removeEventListener('keydown', onKeyDownCapture, true)
      el.removeEventListener('keyup', onKeyUpCapture, true)
      window.removeEventListener('ssh-reconnect', onReconnectEvent)
      unsubData()
      unsubClosed()
      unsubError()
      window.api.ssh.disconnect(sessionId)
      term.dispose()
    }
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

  const closePalette = (): void => {
    setPaletteOpen(false)
    // refocus the terminal after the overlay unmounts so the user can keep typing.
    window.setTimeout(() => termRef.current?.focus(), 0)
  }
  const fillFromPalette = (cmd: string): void => {
    if (statusRef.current === 'connected') window.api.ssh.write(sessionId, cmd)
    closePalette()
  }

  return (
    <div className="flex h-full">
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        style={{ background: preset.wrapperBg }}
      >
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
        {paletteOpen && (
          <CommandPalette
            sessionId={sessionId}
            hostId={hostId}
            connected={status === 'connected'}
            onFill={fillFromPalette}
            onClose={closePalette}
          />
        )}
      </div>
      <TerminalRightPanel
        sessionId={sessionId}
        hostId={hostId}
        connected={status === 'connected'}
      />
    </div>
  )
}
