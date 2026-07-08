import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'

const isMac = window.electron.process.platform === 'darwin'

export function WindowControls(): React.ReactElement | null {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMac) return
    window.api.window.isMaximized().then(setMaximized)
    const unsub = window.api.window.onMaximizeChanged(setMaximized)
    return unsub
  }, [])

  // macOS draws native traffic lights on the left; no custom controls needed.
  if (isMac) return null

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
