import React, { useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
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
export const ESTIMATED_ITEM_PX = 18
/** Entries mounted past each edge of the viewport: each renders on every jump and a scroll
 *  re-renders in the same frame (flushSync), so a few cover measurement jitter.
 *  https://tanstack.com/virtual/latest/docs/api/virtualizer#overscan */
const OVERSCAN_ITEMS = 5

type ListRef = React.RefObject<HTMLDivElement | null>

function offsetWithin(list: HTMLElement, scroller: HTMLElement): number {
  const top = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  return Math.round(top + scroller.scrollTop)
}

/** The list's distance from the top of the scroll element it shares with the other files' lists.
 *  It changes when a file above loads or folds, which resizes the scroll element's content.
 *  https://tanstack.com/virtual/latest/docs/api/virtualizer#scrollmargin */
function useScrollMargin(listRef: ListRef, scrollRef: Props['scrollRef']): number {
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const list = listRef.current
    if (!scroller || !list) return
    const measure = () => setMargin(offsetWithin(list, scroller))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(scroller.firstElementChild ?? scroller)
    return () => observer.disconnect()
  }, [listRef, scrollRef])
  return margin
}

/** Mounts only the diff entries near the viewport of `scrollRef` (TanStack Virtual), measuring each
 *  so comments and notes of any height keep their place. */
function useDiffVirtualizer(props: Omit<Props, 'renderItem'>, scrollMargin: number) {
  const { items, scrollRef } = props
  const virtualizer = useVirtualizer({
    scrollMargin,
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

/** The list placed in the shared scroll element: its virtualizer, and how far below the list's
 *  top the mounted window starts. */
function useDiffList(props: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const scrollMargin = useScrollMargin(listRef, props.scrollRef)
  const virtualizer = useDiffVirtualizer(props, scrollMargin)
  const virtualItems = virtualizer.getVirtualItems()
  const windowTop = (virtualItems[0]?.start ?? scrollMargin) - scrollMargin
  return { listRef, virtualizer, virtualItems, windowTop }
}

export function VirtualDiffList(props: Props) {
  const { items, renderItem } = props
  const { listRef, virtualizer, virtualItems, windowTop } = useDiffList(props)
  return (
    <div
      ref={listRef}
      className="review-diff-virtual"
      style={{ height: virtualizer.getTotalSize() }}
    >
      <div
        className="review-diff-virtual__window"
        style={{ transform: `translateY(${windowTop}px)` }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            data-testid="diff-entry"
            ref={virtualizer.measureElement}
          >
            {renderItem(items[virtualItem.index])}
          </div>
        ))}
      </div>
    </div>
  )
}
