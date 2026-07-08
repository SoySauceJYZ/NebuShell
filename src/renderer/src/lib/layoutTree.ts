import type { LayoutNode, PaneNode, SplitNode } from '../store/useSessionStore'

export type Edge = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface PaneRect {
  pane: PaneNode
  paneRect: Rect
  contentRect: Rect
}

export interface SplitterRect {
  splitId: string
  index: number
  direction: 'row' | 'column'
  rect: Rect
}

export const SPLITTER = 4

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

// ---- queries ----

export function firstPane(node: LayoutNode): PaneNode {
  return node.type === 'pane' ? node : firstPane(node.children[0])
}

export function findPane(node: LayoutNode, paneId: string): PaneNode | null {
  if (node.type === 'pane') return node.id === paneId ? node : null
  for (const c of node.children) {
    const f = findPane(c, paneId)
    if (f) return f
  }
  return null
}

export function paneOfTab(node: LayoutNode, tabId: string): PaneNode | null {
  if (node.type === 'pane') return node.tabIds.includes(tabId) ? node : null
  for (const c of node.children) {
    const f = paneOfTab(c, tabId)
    if (f) return f
  }
  return null
}

export function findSplit(node: LayoutNode, splitId: string): SplitNode | null {
  if (node.type === 'pane') return null
  if (node.id === splitId) return node
  for (const c of node.children) {
    const f = findSplit(c, splitId)
    if (f) return f
  }
  return null
}

// ---- transforms (return new trees) ----

function mapPanes(node: LayoutNode, fn: (p: PaneNode) => PaneNode): LayoutNode {
  if (node.type === 'pane') return fn(node)
  return { ...node, children: node.children.map((c) => mapPanes(c, fn)) }
}

export function setPaneActive(node: LayoutNode, paneId: string, tabId: string): LayoutNode {
  return mapPanes(node, (p) => (p.id === paneId ? { ...p, activeTabId: tabId } : p))
}

export function addTabToPane(node: LayoutNode, paneId: string, tabId: string): LayoutNode {
  return mapPanes(node, (p) =>
    p.id === paneId
      ? {
          ...p,
          tabIds: p.tabIds.includes(tabId) ? p.tabIds : [...p.tabIds, tabId],
          activeTabId: tabId
        }
      : p
  )
}

/** Remove a tab from whichever pane holds it (does not prune empty panes). */
export function removeTabFromTree(node: LayoutNode, tabId: string): LayoutNode {
  if (node.type === 'pane') {
    if (!node.tabIds.includes(tabId)) return node
    const idx = node.tabIds.indexOf(tabId)
    const tabIds = node.tabIds.filter((t) => t !== tabId)
    let activeTabId = node.activeTabId
    if (activeTabId === tabId) activeTabId = tabIds[idx - 1] ?? tabIds[0] ?? ''
    return { ...node, tabIds, activeTabId }
  }
  return { ...node, children: node.children.map((c) => removeTabFromTree(c, tabId)) }
}

/** Drop empty panes and collapse single-child splits. Returns null if nothing remains. */
export function pruneEmpty(node: LayoutNode): LayoutNode | null {
  if (node.type === 'pane') return node.tabIds.length > 0 ? node : null
  const kids = node.children
    .map((c) => pruneEmpty(c))
    .filter((c): c is LayoutNode => c !== null)
  if (kids.length === 0) return null
  if (kids.length === 1) return kids[0]
  return { ...node, children: kids, sizes: kids.map(() => 1) }
}

/** Replace the target pane with a split placing newPane on the given edge. */
export function insertSplitAt(
  node: LayoutNode,
  targetPaneId: string,
  newPane: PaneNode,
  edge: Exclude<Edge, 'center'>
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== targetPaneId) return node
    const direction: 'row' | 'column' = edge === 'left' || edge === 'right' ? 'row' : 'column'
    const children =
      edge === 'left' || edge === 'top' ? [newPane, node] : [node, newPane]
    return { type: 'split', id: newId('split'), direction, children, sizes: [1, 1] }
  }
  return { ...node, children: node.children.map((c) => insertSplitAt(c, targetPaneId, newPane, edge)) }
}

export function updateSizes(node: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (node.type === 'pane') return node
  if (node.id === splitId) return { ...node, sizes }
  return { ...node, children: node.children.map((c) => updateSizes(c, splitId, sizes)) }
}

// ---- geometry ----

export function computeRects(
  node: LayoutNode,
  rect: Rect,
  stripHeight: number
): { panes: PaneRect[]; splitters: SplitterRect[]; splitRects: Map<string, Rect> } {
  const panes: PaneRect[] = []
  const splitters: SplitterRect[] = []
  const splitRects = new Map<string, Rect>()

  const walk = (n: LayoutNode, r: Rect): void => {
    if (n.type === 'pane') {
      panes.push({
        pane: n,
        paneRect: r,
        contentRect: {
          left: r.left,
          top: r.top + stripHeight,
          width: r.width,
          height: Math.max(0, r.height - stripHeight)
        }
      })
      return
    }
    splitRects.set(n.id, r)
    const count = n.children.length
    const total = n.sizes.reduce((a, b) => a + b, 0) || count
    if (n.direction === 'row') {
      const avail = r.width - SPLITTER * (count - 1)
      let x = r.left
      n.children.forEach((c, i) => {
        const w = avail * (n.sizes[i] / total)
        walk(c, { left: x, top: r.top, width: w, height: r.height })
        x += w
        if (i < count - 1) {
          splitters.push({
            splitId: n.id,
            index: i,
            direction: 'row',
            rect: { left: x, top: r.top, width: SPLITTER, height: r.height }
          })
          x += SPLITTER
        }
      })
    } else {
      const avail = r.height - SPLITTER * (count - 1)
      let y = r.top
      n.children.forEach((c, i) => {
        const h = avail * (n.sizes[i] / total)
        walk(c, { left: r.left, top: y, width: r.width, height: h })
        y += h
        if (i < count - 1) {
          splitters.push({
            splitId: n.id,
            index: i,
            direction: 'column',
            rect: { left: r.left, top: y, width: r.width, height: SPLITTER }
          })
          y += SPLITTER
        }
      })
    }
  }

  walk(node, rect)
  return { panes, splitters, splitRects }
}

/** Which edge of a pane rect a point falls in (outer 25% bands → split, else center). */
export function edgeAt(rect: Rect, x: number, y: number): Edge {
  const rx = (x - rect.left) / rect.width
  const ry = (y - rect.top) / rect.height
  const distL = rx
  const distR = 1 - rx
  const distT = ry
  const distB = 1 - ry
  const m = Math.min(distL, distR, distT, distB)
  if (m > 0.25) return 'center'
  if (m === distL) return 'left'
  if (m === distR) return 'right'
  if (m === distT) return 'top'
  return 'bottom'
}

/** The highlight rectangle shown for a pending drop on a given edge. */
export function dropIndicatorRect(rect: Rect, edge: Edge): Rect {
  switch (edge) {
    case 'left':
      return { ...rect, width: rect.width / 2 }
    case 'right':
      return { left: rect.left + rect.width / 2, top: rect.top, width: rect.width / 2, height: rect.height }
    case 'top':
      return { ...rect, height: rect.height / 2 }
    case 'bottom':
      return { left: rect.left, top: rect.top + rect.height / 2, width: rect.width, height: rect.height / 2 }
    default:
      return rect
  }
}
