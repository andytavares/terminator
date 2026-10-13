import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type React from 'react'

interface DragState {
  active: boolean
  startX: number
  startPct: number
  containerWidth: number
}

/** The left column's share of a split diff in percent, kept between 20 and 80 and measured against
 *  `containerRef`'s width, and the divider's mousedown that starts dragging it. */
export function useSplitDrag(containerRef: RefObject<HTMLElement>): {
  splitLeftPct: number
  onDividerMouseDown: (e: React.MouseEvent) => void
} {
  const [splitLeftPct, setSplitLeftPct] = useState(50)
  const drag = useRef<DragState>({ active: false, startX: 0, startPct: 50, containerWidth: 0 })

  useEffect(() => followPointer(drag, setSplitLeftPct), [])

  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      drag.current = {
        active: true,
        startX: e.clientX,
        startPct: splitLeftPct,
        containerWidth: container.getBoundingClientRect().width,
      }
      e.preventDefault()
    },
    [containerRef, splitLeftPct]
  )

  return { splitLeftPct, onDividerMouseDown }
}

/** Moves the split with the pointer while a drag is active; returns the cleanup. */
function followPointer(
  drag: MutableRefObject<DragState>,
  setSplitLeftPct: (pct: number) => void
): () => void {
  const onMove = (e: MouseEvent) => {
    const s = drag.current
    if (!s.active || s.containerWidth === 0) return
    const deltaPct = ((e.clientX - s.startX) / s.containerWidth) * 100
    setSplitLeftPct(Math.max(20, Math.min(80, s.startPct + deltaPct)))
  }
  const onUp = () => {
    drag.current.active = false
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  return () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
}
