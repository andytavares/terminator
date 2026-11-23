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

/** A gutter press or drag selects lines and, released anywhere, stores the selection, which the
 *  float bar then offers to comment on or ask the agent about. */
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
      const selection = {
        path,
        side: drag.side,
        startLine: Math.min(drag.startLine, drag.endLine),
        endLine: Math.max(drag.startLine, drag.endLine),
      }
      setSelection(selection)
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

interface RangeSource {
  preview: DragPreview | null
  selection: LineSelection | null
  path: string
}

/** The range being dragged, or else the stored selection of this file and side. */
function activeRange(
  side: Side,
  source: RangeSource
): { startLine: number; endLine: number } | null {
  const { preview, selection } = source
  if (preview && preview.side === side) {
    const { startLine, endLine } = preview
    return { startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) }
  }
  if (!selection || selection.path !== source.path || selection.side !== side) return null
  return selection
}

/** Whether a line is in the range being dragged, or else in the stored selection. */
function selected(lineNum: number, side: Side, source: RangeSource): boolean {
  const range = activeRange(side, source)
  if (lineNum === 0 || !range) return false
  return lineNum >= range.startLine && lineNum <= range.endLine
}

/** Whether a line is selected, and whether it is the selection's first line. */
function useRangeQueries(source: RangeSource) {
  const { preview, selection, path } = source
  const isLineSelected = useCallback(
    (lineNum: number, side: Side) => selected(lineNum, side, { preview, selection, path }),
    [preview, selection, path]
  )
  const isSelectionStart = useCallback(
    (lineNum: number, side: Side) =>
      activeRange(side, { preview, selection, path })?.startLine === lineNum,
    [preview, selection, path]
  )
  return { isLineSelected, isSelectionStart }
}

/** Selecting lines by dragging over the gutter, and clearing the selection on a background click. */
export function useLineSelection(target: SelectionTarget) {
  const dragRef = useRef<DragState>({ active: false, side: null, startLine: 0, endLine: 0 })
  const justEndedRef = useRef(false)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  useDragEnd(target, { drag: dragRef, justEnded: justEndedRef }, setDragPreview)
  const handlers = useDragHandlers(dragRef, setDragPreview)
  const { selection, path, setSelection } = target
  const queries = useRangeQueries({ preview: dragPreview, selection, path })
  const clearSelectionOnBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (justEndedRef.current) return
      const el = e.target as HTMLElement
      if (el.closest('.rs-float, .diff-gutter-btn, .comment-composer')) return
      if (selection?.path === path) setSelection(null)
    },
    [selection, path, setSelection]
  )
  return {
    dragPreview,
    ...handlers,
    ...queries,
    clearSelectionOnBackgroundClick,
  }
}
