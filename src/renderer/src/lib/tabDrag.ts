/**
 * Pointer-based tab dragging.
 *
 * Electron's native HTML5 drag-and-drop is unreliable inside this window, so
 * tab strips start a drag by dispatching this event and `SplitLayout` runs the
 * whole session with plain mouse listeners.
 */
export interface TabDragStartDetail {
  tabId: string
  clientX: number
  clientY: number
}

export const TAB_DRAG_START = 'tab-drag-start'

/** Begin dragging a tab from the given pointer position. */
export function startTabDrag(tabId: string, clientX: number, clientY: number): void {
  window.dispatchEvent(
    new CustomEvent<TabDragStartDetail>(TAB_DRAG_START, {
      detail: { tabId, clientX, clientY }
    })
  )
}
