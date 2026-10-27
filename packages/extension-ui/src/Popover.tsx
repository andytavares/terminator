import React, { useEffect, useLayoutEffect, useRef } from 'react'
import './extension-ui.css'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a merge repeats the parameter
  interface HTMLAttributes<T> {
    /** The native Popover API: a surface in the top layer that the browser dismisses. */
    popover?: 'auto' | 'manual' | ''
  }
}

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

/**
 * A surface anchored to a control — a picker, a dropdown, a detail panel.
 *
 * It is a native `popover="auto"` element: it sits in the top layer, so no ancestor clips it, and
 * the browser closes it on Escape or a click outside, and gives focus back to what had it. The
 * element it is rendered inside is its anchor: CSS anchor positioning places it under that element
 * and flips it at a window edge.
 *
 * Deliberately *not* a Dialog: the view behind a popover stays live, so it claims no `aria-modal`
 * and traps no focus. See research R10.
 */
export function Popover(props: PopoverProps): JSX.Element {
  const { label, children, className, align = 'start', at, role = 'group', onKeyDown } = props
  const ref = useShownPopover(props.onDismiss, at)
  const classes = [
    'tmui-anchored',
    role === 'group' && 'tmui-popover',
    align === 'end' && 'tmui-anchored--end',
    className,
  ]
  return (
    <div
      ref={ref}
      popover="auto"
      data-tmui-surface=""
      className={classes.filter(Boolean).join(' ')}
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
}

/**
 * Shows the surface as a popover and tells `onDismiss` when the browser closes it; returns the undo.
 *
 * A context menu opens while the button that asked for it is still down (macOS sends `contextmenu`
 * on the press), and the browser takes that button's release for a click outside and closes the
 * menu at once. So a surface asked for mid-press waits for the release.
 */
function openAsPopover(surface: HTMLElement, anchored: boolean, onDismiss: () => void): () => void {
  const onToggle = (event: Event): void => {
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
  surface.addEventListener('toggle', onToggle)
  let timer: ReturnType<typeof setTimeout> | undefined
  const showAfterRelease = (): void => {
    timer = setTimeout(show, 0)
  }
  if (pointerIsDown) document.addEventListener('pointerup', showAfterRelease, { once: true })
  else show()

  return () => {
    document.removeEventListener('pointerup', showAfterRelease)
    clearTimeout(timer)
    surface.removeEventListener('toggle', onToggle)
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
