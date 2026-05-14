import { useState, useRef, useEffect, useCallback } from 'react'

/**
 * Enables a panel to be resized by dragging a divider element.
 * @param initialSize - Starting size in pixels
 * @param min - Minimum size in pixels
 * @param max - Maximum size in pixels
 * @param direction - 1 if dragging right increases size (left panels), -1 if dragging right decreases size (right panels)
 */
export function useResizePanel(
  initialSize: number,
  min: number,
  max: number,
  direction: 1 | -1 = 1
) {
  const [size, setSize] = useState(initialSize)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startSize = useRef(initialSize)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true
      startX.current = e.clientX
      startSize.current = size
      e.preventDefault()
    },
    [size]
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = (e.clientX - startX.current) * direction
      setSize(Math.max(min, Math.min(max, startSize.current + delta)))
    }
    const onUp = () => {
      isDragging.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [min, max, direction])

  return { size, handleMouseDown }
}
