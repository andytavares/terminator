import React, { useEffect, useRef } from 'react'
import { nestedLayerValue } from './layers'
import { useContainingLayer } from './Dialog'
import { useDismissible } from './useDismissible'
import './extension-ui.css'

export interface PopoverProps {
  /** Names the surface for assistive technology. */
  label: string
  children: React.ReactNode
  onDismiss: () => void
  className?: string
}

/**
 * A dismissible surface anchored to a control — a picker, a dropdown, a
 * detail panel.
 *
 * Deliberately *not* a Dialog. The audit scored these against `aria-modal` and a
 * focus trap and marked them failing, but both would be defects here: the view
 * behind a popover stays live, so claiming the page is inert misinforms
 * assistive technology, and trapping focus strands the keyboard in something
 * the user can simply click away from. See research R10.
 *
 * What it does share with Dialog is the part that was genuinely missing: Escape
 * closes it, focus returns to whatever opened it, an outside click dismisses
 * it, it stacks by the published scale, and it counts toward the open-surface
 * depth so the extension-exit gesture stands down while it is up.
 */
export function Popover({ label, children, onDismiss, className }: PopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const parentLayer = useContainingLayer()
  const zIndex = nestedLayerValue('overlay', parentLayer)

  // Escape, an outside click, the open-surface depth and focus moving in. Focus
  // is not trapped: Tab may leave, which is correct for a surface the rest of
  // the view is still usable behind.
  useDismissible({ ref, onDismiss })
  useEffect(() => keepOnScreen(ref.current), [])

  return (
    <div
      ref={ref}
      data-tmui-surface=""
      className={`tmui-popover${className ? ` ${className}` : ''}`}
      style={{ zIndex }}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  )
}

/** Keeps it on screen: anchored near the right or bottom edge, the panel would sit half outside
 * the view with no way to scroll to it. Measured after mount and nudged back, because the overflow
 * depends on the rendered width, which nothing knows in advance. */
function keepOnScreen(el: HTMLElement | null): void {
  if (!el) return
  const margin = 8
  const box = el.getBoundingClientRect()
  const overflowRight = box.right - (window.innerWidth - margin)
  if (overflowRight > 0) el.style.marginLeft = `${-overflowRight}px`
  const overflowBottom = box.bottom - (window.innerHeight - margin)
  if (overflowBottom > 0) el.style.marginTop = `${-overflowBottom}px`
}
