import React, { useImperativeHandle } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DiffItem } from '../../review/diff-items'

export interface VirtualDiffListHandle {
  scrollToIndex: (index: number, align: 'start' | 'center') => void
}

interface Props {
  items: DiffItem[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  renderItem: (item: DiffItem) => React.ReactNode
  handleRef: React.Ref<VirtualDiffListHandle>
}

/** One diff line at the review font; entries are measured once mounted. */
const ESTIMATED_ITEM_PX = 18
/** Entries mounted past each edge of the viewport: each renders on every jump and a scroll
 *  re-renders in the same frame (flushSync), so a few cover measurement jitter.
 *  https://tanstack.com/virtual/latest/docs/api/virtualizer#overscan */
const OVERSCAN_ITEMS = 5

/** Mounts only the diff entries near the viewport of `scrollRef` (TanStack Virtual), measuring each
 *  so comments and notes of any height keep their place. */
function useDiffVirtualizer(props: Omit<Props, 'renderItem'>) {
  const { items, scrollRef } = props
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ITEM_PX,
    getItemKey: (index) => items[index].key,
    overscan: OVERSCAN_ITEMS,
  })
  useImperativeHandle(
    props.handleRef,
    () => ({ scrollToIndex: (index, align) => virtualizer.scrollToIndex(index, { align }) }),
    [virtualizer]
  )
  return virtualizer
}

export function VirtualDiffList(props: Props) {
  const { items, renderItem } = props
  const virtualizer = useDiffVirtualizer(props)
  const virtualItems = virtualizer.getVirtualItems()
  return (
    <div className="review-diff-virtual" style={{ height: virtualizer.getTotalSize() }}>
      <div
        className="review-diff-virtual__window"
        style={{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
          >
            {renderItem(items[virtualItem.index])}
          </div>
        ))}
      </div>
    </div>
  )
}
