import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { captureFocus } from './focus-trap'
import { createModalDepthRegistry } from './modal-depth'

export interface DismissibleOptions {
  /** The surface's own element. Nothing outside it counts as inside. */
  ref: RefObject<HTMLElement | null>
  onDismiss: () => void
  /** Skip moving focus in — for a surface opened without the keyboard. */
  manageFocus?: boolean
  /** Skip the outside-click listener, for a surface that owns its own. */
  closeOnOutsideClick?: boolean
  /**
   * Elements that count as inside even though they sit outside the surface.
   *
   * An anchored popover needs its own trigger here, or clicking the trigger to
   * close it dismisses and immediately reopens.
   */
  alsoInside?: ReadonlyArray<RefObject<HTMLElement | null>>
  /**
   * Listen for Escape in the capture phase.
   *
   * A surface hosting an editor — CodeMirror, xterm — may have its keydown
   * stopped before it reaches the document, so the surface never learns the
   * key was pressed and cannot close. Capture phase sees it first. Off by
   * default: capturing is the wrong default for a surface with nothing that
   * swallows keys, because it reaches Escape ahead of anything nested.
   */
  captureEscape?: boolean
  /**
   * False while the surface is closed.
   *
   * A conditionally-rendered popover cannot call a hook conditionally, so the
   * caller keeps the hook and flips this instead. Disabled it registers no
   * depth, binds no listener and moves no focus.
   */
  enabled?: boolean
}

/**
 * The behaviour half of a dismissible surface, without the presentation.
 *
 * `Popover` is the styled version; this is for the panels that already have a
 * layout worth keeping — a date picker anchored under a field, a drawer docked
 * to an edge — and were only ever missing the behaviour. They get Escape,
 * focus returned to whatever opened them, an outside click, and a place in the
 * open-surface count the extension-exit gesture reads, and keep their own
 * markup untouched.
 */
export function useDismissible({
  ref,
  onDismiss,
  manageFocus = true,
  closeOnOutsideClick = true,
  alsoInside,
  captureEscape = false,
  enabled = true,
}: DismissibleOptions): void {
  // Read through refs so a caller passing a fresh closure each render does not
  // rebind the document listeners on every keystroke.
  const alsoInsideRef = useRef(alsoInside)
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    alsoInsideRef.current = alsoInside
    dismissRef.current = onDismiss
  })

  useEffect(() => {
    if (!enabled) return
    return bindDismissal({
      ref,
      dismissRef,
      alsoInsideRef,
      manageFocus,
      closeOnOutsideClick,
      captureEscape,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, captureEscape])
}

interface Dismissal {
  ref: RefObject<HTMLElement | null>
  dismissRef: MutableRefObject<() => void>
  alsoInsideRef: MutableRefObject<DismissibleOptions['alsoInside']>
  manageFocus: boolean
  closeOnOutsideClick: boolean
  captureEscape: boolean
}

/** Registers the surface's depth, moves focus in and listens; returns the undo. */
function bindDismissal(dismissal: Dismissal): () => void {
  const { ref, manageFocus, closeOnOutsideClick, captureEscape } = dismissal
  const release = createModalDepthRegistry(window).release()
  const restoreFocus = manageFocus && ref.current ? captureFocus(ref.current) : () => {}
  const onKeyDown = escapeListener(dismissal)
  const onPointerDown = outsideClickListener(dismissal)

  document.addEventListener('keydown', onKeyDown, captureEscape)
  // Deferred a tick: the click that opened this surface is still propagating.
  const timer = closeOnOutsideClick
    ? setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0)
    : undefined

  return () => {
    if (timer !== undefined) clearTimeout(timer)
    document.removeEventListener('keydown', onKeyDown, captureEscape)
    document.removeEventListener('mousedown', onPointerDown)
    restoreFocus()
    release()
  }
}

function escapeListener({ ref, dismissRef }: Dismissal): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key !== 'Escape') return
    // Only the surface opened last answers Escape, or a picker inside a dialog
    // would take the dialog down with it.
    if (!isInnermost(ref.current)) return
    e.stopPropagation()
    dismissRef.current()
  }
}

function outsideClickListener({ ref, dismissRef, alsoInsideRef }: Dismissal) {
  return (e: MouseEvent): void => {
    const target = e.target as Node
    if (!ref.current || ref.current.contains(target)) return
    for (const extra of alsoInsideRef.current ?? []) {
      if (extra.current?.contains(target)) return
    }
    dismissRef.current()
  }
}

function isInnermost(el: HTMLElement | null): boolean {
  if (!el) return false
  const surfaces = Array.from(document.querySelectorAll('[data-tmui-panel],[data-tmui-surface]'))
  return surfaces.length === 0 || surfaces[surfaces.length - 1] === el
}
