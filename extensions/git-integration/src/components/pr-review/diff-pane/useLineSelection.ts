import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LineSelection } from '../../../stores/review-ui.store'
import type { Side } from './types'

interface DragState {
  active: boolean
  side: Side | null
  startLine: number
  endLine: number
}

interface DragPreview {
  side: Side
  startLine: number
  endLine: number
}

interface SelectionTarget {
  path: string
  selection: LineSelection | null
  setSelection: (selection: LineSelection | null) => void
}

export type LineDrag = ReturnType<typeof useLineSelection>

function inRange(lineNum: number, a: number, b: number): boolean {
  return lineNum >= Math.min(a, b) && lineNum <= Math.max(a, b)
}

/** A gutter drag selects lines and, released anywhere, stores the selection; the SelectionBar under
 *  it then offers Comment, Ask agent, Explain and Add note. */
function useDragEnd(
  target: SelectionTarget,
  refs: { drag: { current: DragState }; justEnded: { current: boolean } },
  setPreview: (p: DragPreview | null) => void
) {
  const { path, setSelection } = target
  const { drag: dragRef, justEnded } = refs
  useEffect(() => {
    const endGutterDrag = () => {
      const drag = dragRef.current
      if (!drag.active || drag.side == null) return
      drag.active = false
      // The click that follows a multi-row drag lands on the rows' common
      // ancestor, not the gutter button; it must not clear this selection.
      justEnded.current = true
      setTimeout(() => {
        justEnded.current = false
      }, 0)
      setPreview(null)
      const startLine = Math.min(drag.startLine, drag.endLine)
      setSelection({
        path,
        side: drag.side,
        startLine,
        endLine: Math.max(drag.startLine, drag.endLine),
      })
    }
    window.addEventListener('mouseup', endGutterDrag)
    return () => window.removeEventListener('mouseup', endGutterDrag)
  }, [path, setSelection, dragRef, justEnded, setPreview])
}

/** The handlers a row's gutter and body use while the reviewer drags over lines. */
function useDragHandlers(dragRef: { current: DragState }, setPreview: (p: DragPreview) => void) {
  const onGutterMouseDown = useCallback(
    (e: React.MouseEvent, lineNum: number, side: Side) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { active: true, side, startLine: lineNum, endLine: lineNum }
      setPreview({ side, startLine: lineNum, endLine: lineNum })
    },
    [dragRef, setPreview]
  )
  const onRowMouseEnter = useCallback(
    (lineNum: number, side: Side) => {
      const drag = dragRef.current
      if (!drag.active || drag.side !== side || lineNum === 0) return
      drag.endLine = lineNum
      setPreview({ side, startLine: drag.startLine, endLine: lineNum })
    },
    [dragRef, setPreview]
  )
  return { onGutterMouseDown, onRowMouseEnter }
}

/** Whether a line is in the range being dragged, or else in the stored selection. */
function selected(
  lineNum: number,
  side: Side,
  state: { preview: DragPreview | null; target: SelectionTarget }
) {
  const { preview, target } = state
  if (lineNum === 0) return false
  if (preview && preview.side === side) return inRange(lineNum, preview.startLine, preview.endLine)
  const sel = target.selection
  if (!sel || sel.path !== target.path || sel.side !== side) return false
  return lineNum >= sel.startLine && lineNum <= sel.endLine
}

/** Selecting lines by dragging over the gutter, and clearing the selection on a background click. */
export function useLineSelection(target: SelectionTarget) {
  const dragRef = useRef<DragState>({ active: false, side: null, startLine: 0, endLine: 0 })
  const justEndedRef = useRef(false)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  useDragEnd(target, { drag: dragRef, justEnded: justEndedRef }, setDragPreview)
  const handlers = useDragHandlers(dragRef, setDragPreview)
  const { selection, path, setSelection } = target
  const isLineSelected = useCallback(
    (lineNum: number, side: Side) =>
      selected(lineNum, side, { preview: dragPreview, target: { selection, path, setSelection } }),
    [dragPreview, selection, path, setSelection]
  )
  const clearSelectionOnBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (justEndedRef.current) return
      const el = e.target as HTMLElement
      if (el.closest('.rs-float') || el.closest('.diff-gutter-btn')) return
      if (selection?.path === path) setSelection(null)
    },
    [selection, path, setSelection]
  )
  return { dragPreview, ...handlers, isLineSelected, clearSelectionOnBackgroundClick }
}
