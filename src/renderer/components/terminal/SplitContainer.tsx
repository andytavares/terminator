import React, { useRef, useCallback } from 'react'
import type { PaneSplitDirection } from '@shared/types/index'
import './SplitContainer.css'

interface Props {
  splitId: string
  direction: PaneSplitDirection
  ratio: number
  onRatioChange: (splitId: string, ratio: number) => void
  children: [React.ReactNode, React.ReactNode]
}

/** Where the pointer sits across the container, kept between a tenth and nine tenths. */
function ratioAt(container: HTMLElement, ev: MouseEvent, isVertical: boolean): number {
  const rect = container.getBoundingClientRect()
  const pos = isVertical ? ev.clientX : ev.clientY
  const start = isVertical ? rect.left : rect.top
  const size = isVertical ? rect.width : rect.height
  return Math.max(0.1, Math.min(0.9, (pos - start) / size))
}

/** Follows the pointer until the button comes up, reporting each new ratio. */
function trackDividerDrag(
  container: HTMLElement,
  isVertical: boolean,
  onRatio: (ratio: number) => void
): void {
  function onMouseMove(ev: MouseEvent): void {
    onRatio(ratioAt(container, ev, isVertical))
  }

  function onMouseUp(): void {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

/** Dragging the divider moves it, reporting the new ratio for this split. */
function useDividerDrag(
  containerRef: React.RefObject<HTMLDivElement | null>,
  { splitId, direction, onRatioChange }: Pick<Props, 'splitId' | 'direction' | 'onRatioChange'>
): (e: React.MouseEvent) => void {
  const isVertical = direction === 'vertical'
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return
      trackDividerDrag(container, isVertical, (newRatio) => onRatioChange(splitId, newRatio))
    },
    [containerRef, isVertical, splitId, onRatioChange]
  )
}

export function SplitContainer({
  splitId,
  direction,
  ratio,
  onRatioChange,
  children,
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleDividerMouseDown = useDividerDrag(containerRef, { splitId, direction, onRatioChange })

  return (
    <div ref={containerRef} className={`split-container split-container--${direction}`}>
      <div className="split-container__child" style={{ flex: ratio }}>
        {children[0]}
      </div>
      <div
        className={`split-container__divider split-container__divider--${direction}`}
        onMouseDown={handleDividerMouseDown}
      />
      <div className="split-container__child" style={{ flex: 1 - ratio }}>
        {children[1]}
      </div>
    </div>
  )
}
