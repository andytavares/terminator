import React, { useRef, useCallback } from 'react'
import type { PaneSplitDirection } from '../../../../shared/types/index'
import './SplitContainer.css'

interface Props {
  splitId: string
  direction: PaneSplitDirection
  ratio: number
  onRatioChange: (splitId: string, ratio: number) => void
  children: [React.ReactNode, React.ReactNode]
}

export function SplitContainer({
  splitId,
  direction,
  ratio,
  onRatioChange,
  children,
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const isVertical = direction === 'vertical'

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return

      function onMouseMove(ev: MouseEvent): void {
        const rect = container!.getBoundingClientRect()
        const pos = isVertical ? ev.clientX : ev.clientY
        const start = isVertical ? rect.left : rect.top
        const size = isVertical ? rect.width : rect.height
        const newRatio = Math.max(0.1, Math.min(0.9, (pos - start) / size))
        onRatioChange(splitId, newRatio)
      }

      function onMouseUp(): void {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [isVertical, splitId, onRatioChange]
  )

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
