import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface SplitDrag {
  active: boolean
  startX: number
  startPct: number
  containerWidth: number
}

/** Follows the mouse while the divider is held, keeping the left side between 20% and 80%. */
function useSplitDragListeners(dragRef: { current: SplitDrag }, setPct: (pct: number) => void) {
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragRef.current
      if (!s.active || s.containerWidth === 0) return
      const deltaPct = ((e.clientX - s.startX) / s.containerWidth) * 100
      setPct(Math.max(20, Math.min(80, s.startPct + deltaPct)))
    }
    const onUp = () => {
      dragRef.current.active = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragRef, setPct])
}

/**
 * The divider between the two sides of a split diff: dragging it moves the left side's
 * share of `containerRef`'s width. Starts at half.
 */
export function useSplitDivider(containerRef: React.RefObject<HTMLElement | null>) {
  const [splitLeftPct, setSplitLeftPct] = useState(50)
  const dragRef = useRef<SplitDrag>({ active: false, startX: 0, startPct: 50, containerWidth: 0 })
  useSplitDragListeners(dragRef, setSplitLeftPct)
  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const containerWidth = container.getBoundingClientRect().width
      dragRef.current = { active: true, startX: e.clientX, startPct: splitLeftPct, containerWidth }
      e.preventDefault()
    },
    [containerRef, splitLeftPct]
  )
  return { splitLeftPct, onDividerMouseDown }
}
