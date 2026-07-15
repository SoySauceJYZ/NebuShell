import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '../store/useSessionStore'
import {
  computeRects,
  dropIndicatorRect,
  edgeAt,
  findSplit,
  SPLITTER,
  type Edge,
  type PaneRect,
  type Rect,
  type SplitterRect
} from '../lib/layoutTree'
import { TAB_DRAG_START, type TabDragStartDetail } from '../lib/tabDrag'
import { TabContent } from './TabContent'
import { PaneTabStrip } from './PaneTabStrip'

const STRIP_HEIGHT = 32

// Only session/content tabs tear off into new windows; utility singletons stay put.
const DETACHABLE_KINDS = new Set(['terminal', 'sftp', 'explorer', 'editor', 'image'])

function box(r: Rect): React.CSSProperties {
  return { position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Whether a screen-coordinate point falls outside this window's content viewport. */
function isOutsideWindow(screenX: number, screenY: number): boolean {
  const left = window.screenX
  const top = window.screenY
  return (
    screenX < left ||
    screenX > left + window.innerWidth ||
    screenY < top ||
    screenY > top + window.innerHeight
  )
}

export function SplitLayout(): React.ReactElement {
  const tabs = useSessionStore((s) => s.tabs)
  const layout = useSessionStore((s) => s.layout)
  const activePaneId = useSessionStore((s) => s.activePaneId)
  const draggingTabId = useSessionStore((s) => s.draggingTabId)
  const setActivePane = useSessionStore((s) => s.setActivePane)
  const setSplitSizes = useSessionStore((s) => s.setSplitSizes)

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [dropTarget, setDropTarget] = useState<{ paneId: string; edge: Edge } | null>(null)
  // Latest pane geometry, read by the pointer-drag handlers below.
  const panesRef = useRef<PaneRect[]>([])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const multi = layout.type !== 'pane'
  const stripHeight = multi ? STRIP_HEIGHT : 0

  const { panes, splitters, splitRects } = useMemo(
    () => computeRects(layout, { left: 0, top: 0, width: size.w, height: size.h }, stripHeight),
    [layout, size, stripHeight]
  )

  const paneByTab = useMemo(() => {
    const m = new Map<string, PaneRect>()
    for (const pr of panes) for (const tabId of pr.pane.tabIds) m.set(tabId, pr)
    return m
  }, [panes])
  useEffect(() => {
    panesRef.current = panes
  }, [panes])

  const onSplitterDown =
    (s: SplitterRect) =>
    (e: React.MouseEvent): void => {
      e.preventDefault()
      const splitRect = splitRects.get(s.splitId)
      const node = findSplit(layout, s.splitId)
      if (!splitRect || !node) return
      const horizontal = s.direction === 'row'
      const startPos = horizontal ? e.clientX : e.clientY
      const startSizes = [...node.sizes]
      const sum = startSizes.reduce((a, b) => a + b, 0)
      const avail =
        (horizontal ? splitRect.width : splitRect.height) - SPLITTER * (node.children.length - 1)

      const onMove = (ev: MouseEvent): void => {
        const pos = horizontal ? ev.clientX : ev.clientY
        const dw = ((pos - startPos) / avail) * sum
        const sizes = startSizes.map((v, i) =>
          i === s.index ? Math.max(0.1, v + dw) : i === s.index + 1 ? Math.max(0.1, v - dw) : v
        )
        setSplitSizes(s.splitId, sizes)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

  // Pointer-based tab dragging. A strip fires TAB_DRAG_START on mouse-down; we
  // then track the pointer directly (capture phase, so a terminal underneath
  // can't swallow the events) and drop the tab into whatever pane/edge it lands.
  useEffect(() => {
    const targetAt = (clientX: number, clientY: number): { paneId: string; edge: Edge } | null => {
      const cont = containerRef.current?.getBoundingClientRect()
      if (!cont) return null
      const x = clientX - cont.left
      const y = clientY - cont.top
      const pr = panesRef.current.find(
        (p) =>
          x >= p.paneRect.left &&
          x <= p.paneRect.left + p.paneRect.width &&
          y >= p.paneRect.top &&
          y <= p.paneRect.top + p.paneRect.height
      )
      return pr ? { paneId: pr.pane.id, edge: edgeAt(pr.paneRect, x, y) } : null
    }

    const onStart = (ev: Event): void => {
      const { tabId, clientX, clientY } = (ev as CustomEvent<TabDragStartDetail>).detail
      let active = false

      const onMove = (m: MouseEvent): void => {
        if (!active) {
          // Ignore tiny movements so a plain click still just selects the tab.
          if (Math.abs(m.clientX - clientX) + Math.abs(m.clientY - clientY) < 5) return
          active = true
          useSessionStore.getState().setDraggingTab(tabId)
          document.body.style.userSelect = 'none'
        }
        // Outside the window → this drop will tear the tab off; drop the in-window indicator.
        const outside = isOutsideWindow(m.screenX, m.screenY)
        document.body.style.cursor = outside ? 'copy' : 'grabbing'
        setDropTarget(outside ? null : targetAt(m.clientX, m.clientY))
      }

      const onUp = (m: MouseEvent): void => {
        window.removeEventListener('mousemove', onMove, true)
        window.removeEventListener('mouseup', onUp, true)
        setDropTarget(null)
        if (!active) return
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        const store = useSessionStore.getState()
        if (isOutsideWindow(m.screenX, m.screenY)) {
          // Tear off: hand the tab to main (re-dock into a window there, else new window),
          // then drop it locally without killing the session. Only content tabs detach —
          // the singleton utility tabs (hosts/settings/…) stay put.
          const tab = store.tabs.find((t) => t.id === tabId)
          if (tab && DETACHABLE_KINDS.has(tab.kind)) {
            void window.api.window.detachTab({
              tab: tab as unknown as Record<string, unknown>,
              cursor: { x: m.screenX, y: m.screenY }
            })
            store.detachTabLocal(tabId)
          }
          store.setDraggingTab(null)
          return
        }
        const target = targetAt(m.clientX, m.clientY)
        if (target) {
          if (target.edge === 'center') store.moveTabToPane(tabId, target.paneId)
          else store.moveTabToEdge(tabId, target.paneId, target.edge)
        }
        store.setDraggingTab(null)
      }

      window.addEventListener('mousemove', onMove, true)
      window.addEventListener('mouseup', onUp, true)
    }

    window.addEventListener(TAB_DRAG_START, onStart)
    return () => window.removeEventListener(TAB_DRAG_START, onStart)
  }, [])

  const indicator = (() => {
    if (!dropTarget) return null
    const pr = panes.find((p) => p.pane.id === dropTarget.paneId)
    if (!pr) return null
    return dropIndicatorRect(pr.paneRect, dropTarget.edge)
  })()

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {/* Per-pane tab strips (only when the view is split). */}
      {multi &&
        panes.map((pr) => (
          <div
            key={`strip-${pr.pane.id}`}
            style={box({ ...pr.paneRect, height: stripHeight })}
            onMouseDown={() => setActivePane(pr.pane.id)}
          >
            <PaneTabStrip pane={pr.pane} isActivePane={pr.pane.id === activePaneId} />
          </div>
        ))}

      {/* All tab bodies stay mounted; positioned into their pane, shown only when active. */}
      {tabs.map((tab) => {
        const pr = paneByTab.get(tab.id)
        const visible = !!pr && pr.pane.activeTabId === tab.id
        const rect = pr?.contentRect ?? { left: 0, top: 0, width: 0, height: 0 }
        return (
          <div
            key={tab.id}
            style={{ ...box(rect), display: visible ? 'block' : 'none' }}
            className="overflow-hidden"
            onMouseDownCapture={() => pr && setActivePane(pr.pane.id)}
          >
            <TabContent tab={tab} />
          </div>
        )
      })}

      {/* Split handles: a wide transparent grab zone around a thin visible line. */}
      {splitters.map((s) => {
        const row = s.direction === 'row'
        const pad = 4
        const hit: Rect = row
          ? {
              left: s.rect.left - pad,
              top: s.rect.top,
              width: s.rect.width + pad * 2,
              height: s.rect.height
            }
          : {
              left: s.rect.left,
              top: s.rect.top - pad,
              width: s.rect.width,
              height: s.rect.height + pad * 2
            }
        return (
          <div
            key={`${s.splitId}-${s.index}`}
            style={box(hit)}
            onMouseDown={onSplitterDown(s)}
            className={`group z-30 flex ${
              row ? 'cursor-col-resize justify-center' : 'cursor-row-resize flex-col justify-center'
            }`}
          >
            <div
              className={`${
                row ? 'h-full w-1' : 'h-1 w-full'
              } bg-[var(--panel-border)] group-hover:bg-[var(--accent)]`}
            />
          </div>
        )
      })}

      {/* Drop indicator shown while a tab is being dragged. */}
      {draggingTabId && indicator && (
        <div
          style={box(indicator)}
          className="pointer-events-none z-[60] border-2 border-[var(--accent)] bg-[var(--accent)]/20"
        />
      )}
    </div>
  )
}
