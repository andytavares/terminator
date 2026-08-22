import { useCallback, useRef, useState } from 'react'
import type React from 'react'

interface DragItemProps {
  draggable: true
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: () => void
  onDragEnd: () => void
}

interface DragReorder {
  /** Index currently hovered by a drag, for the drop-target style. */
  dragOverIndex: number | null
  getItemProps: (index: number) => DragItemProps
}

/**
 * HTML5 drag-to-reorder for a flat list. `onReorder` receives the reordered
 * array and is responsible for persisting it.
 */
export function useDragReorder<T>(items: T[], onReorder: (reordered: T[]) => void): DragReorder {
  const fromIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Read through a ref so a drop commits against the list as it is now, not as
  // it was when the drag started.
  const itemsRef = useRef(items)
  itemsRef.current = items

  const reset = useCallback(() => {
    fromIndexRef.current = null
    setDragOverIndex(null)
  }, [])

  const getItemProps = useCallback(
    (index: number): DragItemProps => ({
      draggable: true,
      onDragStart: () => {
        fromIndexRef.current = index
      },
      onDragOver: (e) => {
        e.preventDefault()
        setDragOverIndex(index)
      },
      onDragLeave: () => setDragOverIndex(null),
      onDrop: () => {
        const from = fromIndexRef.current
        if (from !== null && from !== index) {
          const reordered = [...itemsRef.current]
          const [moved] = reordered.splice(from, 1)
          reordered.splice(index, 0, moved)
          onReorder(reordered)
        }
        reset()
      },
      onDragEnd: reset,
    }),
    [onReorder, reset]
  )

  return { dragOverIndex, getItemProps }
}
