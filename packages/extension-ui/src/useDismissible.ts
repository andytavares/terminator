import { useEffect, type RefObject } from 'react'
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
  enabled = true,
}: DismissibleOptions): void {
  const alsoInsideRef = { current: alsoInside }
  alsoInsideRef.current = alsoInside
  // Read through a ref so a caller passing a fresh closure each render does not
  // rebind the document listeners on every keystroke.
  const dismissRef = { current: onDismiss }
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!enabled) return
    const registry = createModalDepthRegistry(window as unknown as Record<string, unknown>)
    const release = registry.release()
    const restoreFocus = manageFocus && ref.current ? captureFocus(ref.current) : () => {}

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      // Only the surface opened last answers Escape, or a picker inside a dialog
      // would take the dialog down with it.
      if (!isInnermost(ref.current)) return
      e.stopPropagation()
      dismissRef.current()
    }

    function onPointerDown(e: MouseEvent): void {
      const target = e.target as Node
      if (!ref.current || ref.current.contains(target)) return
      for (const extra of alsoInsideRef.current ?? []) {
        if (extra.current?.contains(target)) return
      }
      dismissRef.current()
    }

    document.addEventListener('keydown', onKeyDown)
    // Deferred a tick: the click that opened this surface is still propagating.
    const timer = closeOnOutsideClick
      ? setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0)
      : undefined

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
      restoreFocus()
      release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}

function isInnermost(el: HTMLElement | null): boolean {
  if (!el) return false
  const surfaces = Array.from(document.querySelectorAll('[data-tmui-panel],[data-tmui-surface]'))
  return surfaces.length === 0 || surfaces[surfaces.length - 1] === el
}
