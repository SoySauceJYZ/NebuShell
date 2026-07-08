import { useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { TabContent } from './TabContent'
import { PaneTabStrip } from './PaneTabStrip'

const STRIP_HEIGHT = 32

function box(r: Rect): React.CSSProperties {
  return { position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height }
}

export function SplitLayout(): React.ReactElement {
  const tabs = useSessionStore((s) => s.tabs)
  const layout = useSessionStore((s) => s.layout)
  const activePaneId = useSessionStore((s) => s.activePaneId)
  const draggingTabId = useSessionStore((s) => s.draggingTabId)
  const setActivePane = useSessionStore((s) => s.setActivePane)
  const setDraggingTab = useSessionStore((s) => s.setDraggingTab)
  const setSplitSizes = useSessionStore((s) => s.setSplitSizes)
  const moveTabToEdge = useSessionStore((s) => s.moveTabToEdge)
  const moveTabToPane = useSessionStore((s) => s.moveTabToPane)

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [dropTarget, setDropTarget] = useState<{ paneId: string; edge: Edge } | null>(null)

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

  const onSplitterDown = (s: SplitterRect) => (e: React.MouseEvent): void => {
    e.preventDefault()
    const splitRect = splitRects.get(s.splitId)
    const node = findSplit(layout, s.splitId)
    if (!splitRect || !node) return
    const horizontal = s.direction === 'row'
    const startPos = horizontal ? e.clientX : e.clientY
    const startSizes = [...node.sizes]
    const sum = startSizes.reduce((a, b) => a + b, 0)
    const avail = (horizontal ? splitRect.width : splitRect.height) - SPLITTER * (node.children.length - 1)

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

  const onOverlayDragOver = (e: React.DragEvent): void => {
    if (!draggingTabId) return
    e.preventDefault()
    const cont = containerRef.current?.getBoundingClientRect()
    if (!cont) return
    const x = e.clientX - cont.left
    const y = e.clientY - cont.top
    const pr = panes.find(
      (p) =>
        x >= p.paneRect.left &&
        x <= p.paneRect.left + p.paneRect.width &&
        y >= p.paneRect.top &&
        y <= p.paneRect.top + p.paneRect.height
    )
    setDropTarget(pr ? { paneId: pr.pane.id, edge: edgeAt(pr.paneRect, x, y) } : null)
  }

  const onOverlayDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const tabId = draggingTabId || e.dataTransfer.getData('text/x-tab')
    if (tabId && dropTarget) {
      if (dropTarget.edge === 'center') moveTabToPane(tabId, dropTarget.paneId)
      else moveTabToEdge(tabId, dropTarget.paneId, dropTarget.edge)
    }
    setDropTarget(null)
    setDraggingTab(null)
  }

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

      {/* Split handles. */}
      {splitters.map((s) => (
        <div
          key={`${s.splitId}-${s.index}`}
          style={box(s.rect)}
          onMouseDown={onSplitterDown(s)}
          className={`z-30 ${
            s.direction === 'row' ? 'cursor-col-resize' : 'cursor-row-resize'
          } bg-[var(--panel-border)] hover:bg-[var(--accent)]`}
        />
      ))}

      {/* Drop overlay shown only while a tab is being dragged. */}
      {draggingTabId && (
        <div
          className="absolute inset-0 z-[60]"
          onDragOver={onOverlayDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
          }}
          onDrop={onOverlayDrop}
        >
          {indicator && (
            <div
              style={box(indicator)}
              className="pointer-events-none border-2 border-[var(--accent)] bg-[var(--accent)]/20"
            />
          )}
        </div>
      )}
    </div>
  )
}
