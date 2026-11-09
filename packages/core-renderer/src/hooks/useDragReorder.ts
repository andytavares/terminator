import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'

export interface DragItemProps {
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

/** The list as it is now, read through a ref so a drop commits against it rather than the list
 * as it was when the drag started. */
function useCurrentItems<T>(items: T[]): React.MutableRefObject<T[]> {
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  })
  return itemsRef
}

/** `items` with the one at `from` moved to `to`. */
export function moved<T>(items: T[], from: number, to: number): T[] {
  const reordered = [...items]
  const [item] = reordered.splice(from, 1)
  reordered.splice(to, 0, item)
  return reordered
}

/** Where the drag in this list started and which row it is over; `reset` forgets both. */
function useReorderDragState() {
  const fromIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const reset = useCallback(() => {
    fromIndexRef.current = null
    setDragOverIndex(null)
  }, [])
  return { fromIndexRef, dragOverIndex, setDragOverIndex, reset }
}

/** HTML5 drag-to-reorder for a flat list; `onReorder` persists the new order. A drag from
 * outside the list (a session on its way to an agent tab) is not a reorder, so no row takes it. */
export function useDragReorder<T>(items: T[], onReorder: (reordered: T[]) => void): DragReorder {
  const { fromIndexRef, dragOverIndex, setDragOverIndex, reset } = useReorderDragState()
  const itemsRef = useCurrentItems(items)

  const getItemProps = useCallback(
    (index: number): DragItemProps => ({
      draggable: true,
      onDragStart: () => {
        fromIndexRef.current = index
      },
      onDragOver: (e) => {
        if (fromIndexRef.current === null) return
        e.preventDefault()
        setDragOverIndex(index)
      },
      onDragLeave: () => setDragOverIndex(null),
      onDrop: () => {
        const from = fromIndexRef.current
        if (from !== null && from !== index) onReorder(moved(itemsRef.current, from, index))
        reset()
      },
      onDragEnd: reset,
    }),
    [onReorder, reset, itemsRef, fromIndexRef, setDragOverIndex]
  )

  return { dragOverIndex, getItemProps }
}
