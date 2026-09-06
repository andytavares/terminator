import React, { useEffect, useRef } from 'react'
import { captureFocus } from './focus-trap'
import { nestedLayerValue } from './layers'
import { createModalDepthRegistry } from './modal-depth'
import { useContainingLayer } from './Dialog'
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

  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    const registry = createModalDepthRegistry(window as unknown as Record<string, unknown>)
    const release = registry.release()
    // Focus moves in, but is not trapped: Tab may leave, and that is correct for
    // a surface the rest of the view is still usable behind.
    const restoreFocus = ref.current ? captureFocus(ref.current) : () => {}

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      if (!isInnermostSurface(ref.current)) return
      e.stopPropagation()
      dismissRef.current()
    }

    function onPointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) dismissRef.current()
    }

    /**
     * Keep it on screen.
     *
     * The surface is absolutely positioned against whatever the caller
     * anchored it to, and a control near the right or bottom edge — the caret
     * beside a commit button, say — puts the panel half outside the view with
     * no way to scroll to it. Measured after mount and nudged back, because
     * the overflow depends on the rendered width, which nothing knows in
     * advance.
     */
    const el = ref.current
    if (el) {
      const margin = 8
      const box = el.getBoundingClientRect()
      const overflowRight = box.right - (window.innerWidth - margin)
      if (overflowRight > 0) el.style.marginLeft = `${-overflowRight}px`
      const overflowBottom = box.bottom - (window.innerHeight - margin)
      if (overflowBottom > 0) el.style.marginTop = `${-overflowBottom}px`
    }

    document.addEventListener('keydown', onKeyDown)
    // Deferred a tick: the click that opened this popover is still propagating,
    // and would otherwise close it immediately.
    const timer = setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
      restoreFocus()
      release()
    }
  }, [])

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

/** The most recently opened surface, dialog or popover, owns Escape. */
function isInnermostSurface(el: HTMLElement | null): boolean {
  if (!el) return false
  const surfaces = Array.from(document.querySelectorAll('[data-tmui-panel],[data-tmui-surface]'))
  return surfaces[surfaces.length - 1] === el
}
