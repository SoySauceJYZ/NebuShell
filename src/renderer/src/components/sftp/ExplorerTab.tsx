import { Fragment, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Plus, X, HardDrive, Server } from 'lucide-react'
import { useVaultStore } from '../../store/useVaultStore'
import { RemotePane } from './RemotePane'
import { LocalPane } from './LocalPane'
import { TransfersPanel } from './TransfersPanel'

interface BasePane {
  paneId: string
  weight: number
}
type PaneState = (BasePane & { kind: 'remote'; hostId: string }) | (BasePane & { kind: 'local' })

function pid(): string {
  return crypto?.randomUUID ? crypto.randomUUID().slice(0, 8) : `p${Date.now()}${Math.random()}`
}

export function ExplorerTab({
  tabId,
  initialHostId
}: {
  tabId: string
  initialHostId?: string
}): React.ReactElement {
  const hosts = useVaultStore((s) => s.hosts)
  const [panes, setPanes] = useState<PaneState[]>(() => {
    const init: PaneState[] = [{ paneId: pid(), kind: 'local', weight: 1 }]
    if (initialHostId)
      init.push({ paneId: pid(), kind: 'remote', hostId: initialHostId, weight: 1 })
    return init
  })
  const containerRef = useRef<HTMLDivElement>(null)

  const addPane = (p: PaneState): void => setPanes((ps) => [...ps, p])
  const removePane = (paneId: string): void =>
    setPanes((ps) => (ps.length <= 1 ? ps : ps.filter((p) => p.paneId !== paneId)))

  const startResize =
    (index: number) =>
    (e: React.MouseEvent): void => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return
      const totalWidth = container.clientWidth
      const startX = e.clientX
      const startWeights = panes.map((p) => p.weight)
      const sum = startWeights.reduce((a, b) => a + b, 0)

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - startX
        const dw = (dx / totalWidth) * sum
        setPanes((ps) =>
          ps.map((p, i) => {
            if (i === index) return { ...p, weight: Math.max(0.15, startWeights[i] + dw) }
            if (i === index + 1) return { ...p, weight: Math.max(0.15, startWeights[i + 1] - dw) }
            return p
          })
        )
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          文件浏览器
        </span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="btn-secondary ml-1 px-2.5 py-1">
              <Plus size={14} />
              添加面板
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className="z-[70] max-h-80 min-w-[200px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
            >
              <DropdownMenu.Item
                onSelect={() => addPane({ paneId: pid(), kind: 'local', weight: 1 })}
                className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
              >
                <HardDrive size={15} className="text-[var(--text-muted)]" />
                本地文件
              </DropdownMenu.Item>
              {hosts.length > 0 && (
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
              )}
              {hosts.map((h) => (
                <DropdownMenu.Item
                  key={h.id}
                  onSelect={() =>
                    addPane({ paneId: pid(), kind: 'remote', hostId: h.id, weight: 1 })
                  }
                  className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                >
                  <Server size={15} className="text-[var(--text-muted)]" />
                  {h.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div ref={containerRef} className="flex min-h-0 flex-1">
        {panes.map((pane, i) => {
          const host = pane.kind === 'remote' ? hosts.find((h) => h.id === pane.hostId) : null
          const title = pane.kind === 'local' ? '本地' : (host?.label ?? '远程')
          return (
            <Fragment key={pane.paneId}>
              <div
                className="flex min-w-0 flex-col"
                style={{ flexGrow: pane.weight, flexBasis: 0 }}
              >
                <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] bg-[var(--content-bg)] px-3 py-1">
                  {pane.kind === 'local' ? (
                    <HardDrive size={12} className="text-[var(--text-muted)]" />
                  ) : (
                    <Server size={12} className="text-[var(--text-muted)]" />
                  )}
                  <span className="flex-1 truncate text-xs font-medium text-[var(--text-dark)]">
                    {title}
                  </span>
                  {panes.length > 1 && (
                    <button
                      onClick={() => removePane(pane.paneId)}
                      className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
                      title="关闭面板"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="min-h-0 flex-1">
                  {pane.kind === 'local' ? (
                    <LocalPane ownerId={tabId} />
                  ) : (
                    <RemotePane
                      sessionId={`explorer-${tabId}-${pane.paneId}`}
                      hostId={pane.hostId}
                      ownerId={tabId}
                    />
                  )}
                </div>
              </div>
              {i < panes.length - 1 && (
                <div
                  onMouseDown={startResize(i)}
                  className="w-1 shrink-0 cursor-col-resize border-l border-[var(--panel-border)] hover:bg-[var(--accent)]"
                />
              )}
            </Fragment>
          )
        })}
      </div>

      <TransfersPanel ownerId={tabId} />
    </div>
  )
}
