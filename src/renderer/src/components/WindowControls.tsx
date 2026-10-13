import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { IS_WEB } from '../lib/env'

// macOS draws native traffic lights; a browser tab has its own chrome.
const hidden = IS_WEB || window.electron.process.platform === 'darwin'

export function WindowControls(): React.ReactElement | null {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (hidden) return
    window.api.window.isMaximized().then(setMaximized)
    const unsub = window.api.window.onMaximizeChanged(setMaximized)
    return unsub
  }, [])

  if (hidden) return null

  return (
    <div
      className="flex h-full items-stretch"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={() => window.api.window.minimize()}
        title="最小化"
        className="flex w-11 items-center justify-center text-[var(--text-muted)] transition hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]"
      >
        <Minus size={16} />
      </button>
      <button
        onClick={() => window.api.window.toggleMaximize()}
        title={maximized ? '还原' : '最大化'}
        className="flex w-11 items-center justify-center text-[var(--text-muted)] transition hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]"
      >
        {maximized ? <Copy size={13} /> : <Square size={13} />}
      </button>
      <button
        onClick={() => window.api.window.close()}
        title="关闭"
        className="flex w-11 items-center justify-center text-[var(--text-muted)] transition hover:bg-[#e5484d] hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  )
}
