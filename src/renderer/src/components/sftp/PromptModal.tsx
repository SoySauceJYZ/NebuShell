import { useState, useCallback } from 'react'

interface PromptState {
  title: string
  value: string
  resolve: (v: string | null) => void
}

/** A tiny text-input modal — Electron disables the native window.prompt(). */
export function usePromptModal(): {
  ask: (title: string, defaultValue?: string) => Promise<string | null>
  node: React.ReactElement | null
} {
  const [state, setState] = useState<PromptState | null>(null)

  const ask = useCallback(
    (title: string, defaultValue = ''): Promise<string | null> =>
      new Promise((resolve) => setState({ title, value: defaultValue, resolve })),
    []
  )

  const close = (value: string | null): void => {
    state?.resolve(value)
    setState(null)
  }

  const node = state ? (
    <div
      className="absolute inset-0 z-[90] flex items-center justify-center bg-black/30"
      onMouseDown={() => close(null)}
    >
      <div
        className="w-80 rounded-[var(--radius)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-sm font-medium text-[var(--text-dark)]">{state.title}</div>
        <input
          autoFocus
          className="input w-full"
          value={state.value}
          onChange={(e) => setState({ ...state, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close(state.value.trim() || null)
            if (e.key === 'Escape') close(null)
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-secondary px-3 py-1.5" onClick={() => close(null)}>
            取消
          </button>
          <button
            className="btn-primary px-3 py-1.5"
            onClick={() => close(state.value.trim() || null)}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { ask, node }
}
