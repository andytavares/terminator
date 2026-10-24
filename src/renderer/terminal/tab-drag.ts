import type React from 'react'
import { create } from 'zustand'
import { useBreakoutStore } from '../stores/breakout.store'

// A terminal's tab is dragged with the pointer captured, not with HTML drag and drop. The captured
// pointer reports its release at once, even outside the window; a native drag ends only after
// macOS slides an unaccepted drop back to where it started.

export interface ScreenPoint {
  x: number
  y: number
}

type WindowBounds = Pick<Window, 'screenX' | 'screenY' | 'outerWidth' | 'outerHeight'>

/** Starting a drag takes this many pixels of movement; anything less is a click. */
const DRAG_DISTANCE = 4

interface TabDrag {
  /** The terminal whose tab is being dragged. */
  sessionId: string | null
  /** The tab under the pointer, in the window the drag started in. */
  overSessionId: string | null
  overMainWindow: boolean
}

const IDLE: TabDrag = { sessionId: null, overSessionId: null, overMainWindow: false }

export const useTabDragStore = create<TabDrag>(() => IDLE)

export function windowContains(win: WindowBounds, point: ScreenPoint): boolean {
  return (
    point.x >= win.screenX &&
    point.x < win.screenX + win.outerWidth &&
    point.y >= win.screenY &&
    point.y < win.screenY + win.outerHeight
  )
}

/** Whether the point is over the main window or a terminal's own window. Every one of them is a
 * window of this renderer, so their bounds are known here. */
export function isOverTerminatorWindow(point: ScreenPoint): boolean {
  const windows = [window, ...useBreakoutStore.getState().windows.values()]
  return windows.some((win) => windowContains(win, point))
}

function screenPointOf(event: PointerEvent): ScreenPoint {
  return { x: event.screenX, y: event.screenY }
}

function tabUnder(event: PointerEvent, doc: Document): string | null {
  const tab = doc
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest<HTMLElement>('[data-session-tab]')
  return tab?.dataset.sessionTab ?? null
}

/** The release ends the drag on the tab, so the browser then clicks it: that click is not one. */
function swallowNextClick(tab: HTMLElement): void {
  const swallow = (e: Event): void => e.stopPropagation()
  tab.addEventListener('click', swallow, { capture: true, once: true })
  tab.ownerDocument.defaultView?.setTimeout(() =>
    tab.removeEventListener('click', swallow, { capture: true })
  )
}

type OnDrop = (point: ScreenPoint, overSessionId: string | null) => void

interface Press {
  tab: HTMLElement
  sessionId: string
  start: ScreenPoint
}

function showDragAt(sessionId: string, e: PointerEvent, doc: Document): void {
  useTabDragStore.setState({
    sessionId,
    overSessionId: tabUnder(e, doc),
    overMainWindow: windowContains(window, screenPointOf(e)),
  })
}

type DragListeners = {
  [Type in 'pointermove' | 'pointerup' | 'pointercancel' | 'keydown']: (
    e: DocumentEventMap[Type]
  ) => void
}

/** Listens to the pointer from the press until its release, Escape or a pointercancel. */
function followPress({ tab, sessionId, start }: Press, onDrop: OnDrop): void {
  const doc = tab.ownerDocument
  let dragging = false
  const listeners: DragListeners = {
    pointermove: (e: PointerEvent) => {
      const { x, y } = screenPointOf(e)
      if (!dragging && Math.hypot(x - start.x, y - start.y) < DRAG_DISTANCE) return
      // Captured only now: a capture from the press would take the click from the tab's close button.
      if (!dragging) tab.setPointerCapture(e.pointerId)
      dragging = true
      showDragAt(sessionId, e, doc)
    },
    pointerup: (e: PointerEvent) => {
      stop()
      if (!dragging) return
      swallowNextClick(tab)
      onDrop(screenPointOf(e), tabUnder(e, doc))
    },
    pointercancel: () => stop(),
    keydown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
    },
  }
  const entries = Object.entries(listeners) as [string, EventListener][]
  function stop(): void {
    entries.forEach(([type, listener]) => doc.removeEventListener(type, listener))
    useTabDragStore.setState(IDLE)
  }
  entries.forEach(([type, listener]) => doc.addEventListener(type, listener))
}

/** Follows a press on a terminal's tab. Once it moves far enough it is a drag, and its release
 * calls `onDrop` with where it was let go and the tab under it, if any. Escape cancels it. */
export function beginTabDrag(
  press: React.PointerEvent<HTMLElement>,
  sessionId: string,
  onDrop: OnDrop
): void {
  if (press.button !== 0) return
  const tab = press.currentTarget
  followPress({ tab, sessionId, start: { x: press.screenX, y: press.screenY } }, onDrop)
}
