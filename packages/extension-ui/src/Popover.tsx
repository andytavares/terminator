import React, { useEffect, useLayoutEffect, useRef } from 'react'
import './extension-ui.css'

export interface PopoverProps {
  /** Names the surface for assistive technology. */
  label: string
  children: React.ReactNode
  onDismiss: () => void
  className?: string
  /** Which edge of the trigger the surface lines up with. */
  align?: 'start' | 'end'
  /** A point in the window, for a surface with no trigger: a context menu. */
  at?: { x: number; y: number }
  /** `menu` for a list of actions (see Menu); `group` for anything else. */
  role?: 'group' | 'menu'
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
}

const SURFACE_ATTRIBUTES = { popover: 'auto', 'data-tmui-surface': '' } as const

/** A surface anchored to its parent element: a picker, a dropdown, a detail panel. A native popover
 * in the top layer: the browser closes it on Escape or an outside click and returns focus. Not a
 * Dialog: the view behind stays live, so no `aria-modal`, no focus trap (research R10). */
export function Popover(props: PopoverProps): React.JSX.Element {
  const { label, children, className, align = 'start', at, role = 'group', onKeyDown } = props
  const ref = useShownPopover(props.onDismiss, at)
  return (
    <div
      ref={ref}
      {...SURFACE_ATTRIBUTES}
      className={popoverClasses(role, align, className)}
      style={at ? { left: at.x, top: at.y, right: 'auto' } : undefined}
      role={role}
      tabIndex={-1}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

function popoverClasses(role: string, align: string, className?: string): string {
  const classes = ['tmui-anchored', role === 'group' && 'tmui-popover']
  return [...classes, align === 'end' && 'tmui-anchored--end', className].filter(Boolean).join(' ')
}

/** Shows the surface on mount, keeps it on screen when it opens at a point, and reports the
 * browser closing it. */
function useShownPopover(onDismiss: () => void, at: PopoverProps['at']) {
  const ref = useRef<HTMLDivElement>(null)
  // Read through a ref so a caller's fresh closure does not reopen the surface on every render.
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })
  const anchored = at === undefined
  useLayoutEffect(() => {
    const surface = ref.current
    return surface ? openAsPopover(surface, anchored, () => dismissRef.current()) : undefined
  }, [anchored])
  // Measured on every render with a point: an item that changes while open can widen the menu.
  useLayoutEffect(() => keepOnScreen(at ? ref.current : null), [at])
  return ref
}

/** What Tab reaches. `[tabindex="-1"]` takes focus from code only, so it is no place to start. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let pointerIsDown = false
if (typeof document !== 'undefined') {
  const note = (down: boolean) => () => void (pointerIsDown = down)
  document.addEventListener('pointerdown', note(true), true)
  document.addEventListener('pointerup', note(false), true)
  document.addEventListener('pointercancel', note(false), true)
  // A release the window never saw (let go outside it) would leave this stuck: a click proves the
  // button is up, and a context menu says in `buttons` whether one is held.
  document.addEventListener('click', note(false), true)
  document.addEventListener(
    'contextmenu',
    (event) => void (pointerIsDown = event.buttons !== 0),
    true
  )
}

/** Shows the surface as a popover, tells `onDismiss` when the browser closes it; returns the undo.
 * macOS sends `contextmenu` on the press and the browser takes the release for an outside click,
 * so a surface asked for mid-press waits for the release. */
function openAsPopover(surface: HTMLElement, anchored: boolean, onDismiss: () => void): () => void {
  const closeOnToggle = (event: Event): void => {
    if ((event as ToggleEvent).newState === 'closed') onDismiss()
  }
  const show = (): void => {
    surface.showPopover(anchored ? { source: surface.parentElement ?? undefined } : undefined)
    if (!anchored) keepOnScreen(surface)
    // The browser moves no focus in; a field inside that took it on mount keeps it.
    if (!surface.contains(document.activeElement)) {
      ;(surface.querySelector<HTMLElement>(FOCUSABLE) ?? surface).focus()
    }
  }
  surface.addEventListener('toggle', closeOnToggle)
  let timer: ReturnType<typeof setTimeout> | undefined
  const showAfterRelease = (): void => {
    timer = setTimeout(show, 0)
  }
  if (pointerIsDown) document.addEventListener('pointerup', showAfterRelease, { once: true })
  else show()

  return () => {
    document.removeEventListener('pointerup', showAfterRelease)
    clearTimeout(timer)
    surface.removeEventListener('toggle', closeOnToggle)
    // Closed here, while it is still in the document, so focus goes back to what had it.
    if (surface.matches(':popover-open')) surface.hidePopover()
  }
}

/** Keeps it on screen: opened at a point near the right or bottom edge, the surface would sit half
 * outside the view with no way to scroll to it. Measured after mount and nudged back, because the
 * overflow depends on the rendered width, which nothing knows in advance. */
function keepOnScreen(el: HTMLElement | null): void {
  if (!el) return
  // Measure from the point: a nudge left from an earlier position would skew the box.
  el.style.marginLeft = ''
  el.style.marginTop = ''
  const margin = 8
  const box = el.getBoundingClientRect()
  const overflowRight = box.right - (window.innerWidth - margin)
  if (overflowRight > 0) el.style.marginLeft = `${-overflowRight}px`
  const overflowBottom = box.bottom - (window.innerHeight - margin)
  if (overflowBottom > 0) el.style.marginTop = `${-overflowBottom}px`
}
