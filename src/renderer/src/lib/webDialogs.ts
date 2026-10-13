// Browser stand-ins for the native dialogs the desktop app gets from Electron. Plain DOM
// (not React) because they are called from the web client's IPC shim, outside any tree.

export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Same contract as `window.api.dialog.confirm` on desktop: resolves true on confirm. */
export function confirmModal(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el('div', 'fixed inset-0 z-[200] flex items-center justify-center bg-black/30')
    const box = el(
      'div',
      'w-[26rem] max-w-[90vw] rounded-[var(--radius-md)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-5 shadow-xl'
    )
    box.appendChild(el('div', 'text-sm font-medium text-[var(--text-dark)]', opts.message))
    if (opts.detail) {
      box.appendChild(
        el('div', 'mt-2 whitespace-pre-wrap text-xs text-[var(--text-muted)]', opts.detail)
      )
    }
    const row = el('div', 'mt-4 flex justify-end gap-2')
    const cancel = el('button', 'btn-secondary px-3 py-1.5', opts.cancelLabel ?? '否')
    const ok = el('button', 'btn-primary px-3 py-1.5', opts.confirmLabel ?? '是')
    row.append(cancel, ok)
    box.appendChild(row)
    overlay.appendChild(box)

    const done = (value: boolean): void => {
      document.removeEventListener('keydown', onKey, true)
      overlay.remove()
      resolve(value)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        done(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        done(true)
      }
    }
    cancel.onclick = () => done(false)
    ok.onclick = () => done(true)
    overlay.onmousedown = (e) => {
      if (e.target === overlay) done(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.body.appendChild(overlay)
    ok.focus()
  })
}

/** Open the browser's file picker. Resolves [] when the user cancels. */
export function pickBrowserFiles(
  opts: { multiple?: boolean; accept?: string } = {}
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = opts.multiple ?? true
    if (opts.accept) input.accept = opts.accept
    input.style.display = 'none'
    input.onchange = () => {
      resolve(Array.from(input.files ?? []))
      input.remove()
    }
    // Fires in current Chromium/Firefox/Safari when the dialog is dismissed.
    input.addEventListener('cancel', () => {
      resolve([])
      input.remove()
    })
    document.body.appendChild(input)
    input.click()
  })
}

/** Hand a file to the browser's download manager. */
export function triggerDownload(href: string, filename?: string): void {
  const a = document.createElement('a')
  a.href = href
  if (filename) a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function downloadText(filename: string, content: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  triggerDownload(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** A small bottom-right progress card for the browser → server leg of an upload. */
export function progressToast(title: string): { update(ratio: number): void; close(): void } {
  const card = el(
    'div',
    'fixed bottom-4 right-4 z-[180] w-72 rounded-[var(--radius-md)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3 shadow-lg'
  )
  const label = el('div', 'truncate text-xs text-[var(--text-dark)]', title)
  const track = el('div', 'mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--nav-bg-hover)]')
  const bar = el('div', 'h-full bg-[var(--accent)] transition-[width]')
  bar.style.width = '0%'
  track.appendChild(bar)
  card.append(label, track)
  document.body.appendChild(card)
  return {
    update: (ratio) => {
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`
    },
    close: () => card.remove()
  }
}
