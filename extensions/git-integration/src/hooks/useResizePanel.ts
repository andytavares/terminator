import { useState, useRef, useEffect, useCallback } from 'react'

interface Drag {
  active: boolean
  startX: number
  startSize: number
}

/** While a drag is active, each mouse move sets the size from how far the mouse has gone. */
function useDragListeners(
  dragRef: { current: Drag },
  sizeFor: (delta: number) => number,
  setSize: (size: number) => void
) {
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current.active) setSize(sizeFor(e.clientX - dragRef.current.startX))
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
  }, [dragRef, sizeFor, setSize])
}

/**
 * Enables a panel to be resized by dragging a divider element.
 * @param initialSize - Starting size in pixels
 * @param bounds - Smallest and largest size in pixels
 * @param direction - 1 if dragging right increases size (left panels), -1 if dragging right decreases size (right panels)
 */
export function useResizePanel(
  initialSize: number,
  bounds: { min: number; max: number },
  direction: 1 | -1 = 1
) {
  const { min, max } = bounds
  const [size, setSize] = useState(initialSize)
  const dragRef = useRef<Drag>({ active: false, startX: 0, startSize: initialSize })
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = { active: true, startX: e.clientX, startSize: size }
      e.preventDefault()
    },
    [size]
  )
  const sizeFor = useCallback(
    (delta: number) => Math.max(min, Math.min(max, dragRef.current.startSize + delta * direction)),
    [min, max, direction]
  )
  useDragListeners(dragRef, sizeFor, setSize)
  return { size, handleMouseDown }
}
