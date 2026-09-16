import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/** Breathing room kept between a menu and the window's edges. */
const MARGIN = 8
/** Gap between the button and the menu it opens. */
const GAP = 4

/**
 * Where a menu panel sits, measured rather than assumed.
 *
 * Fixed to the viewport, so a panel opened from inside a scrolling area is not
 * clipped by it, and clamped to the window, so a control near an edge — Home's
 * Display button is hard against the right — still opens a panel you can read.
 */
export function useMenuPlacement(
  open: boolean,
  buttonRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>
): CSSProperties {
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const measure = (): void => {
      const button = buttonRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (button === undefined || panel === undefined) return

      const maxLeft = window.innerWidth - panel.width - MARGIN
      const left = Math.max(MARGIN, Math.min(button.left, maxLeft))

      const below = button.bottom + GAP
      const above = button.top - panel.height - GAP
      const fitsBelow = below + panel.height <= window.innerHeight - MARGIN

      setPlacement({ left, top: fitsBelow ? below : Math.max(MARGIN, above) })
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, buttonRef, panelRef])

  return placement === null
    ? { position: 'fixed', visibility: 'hidden' }
    : { position: 'fixed', left: placement.left, top: placement.top }
}
