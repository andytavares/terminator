/**
 * Keyboard focus containment for a modal surface.
 *
 * Hand-rolled rather than taken as a dependency: it is one component's worth of
 * behaviour, and Constitution IV requires the standard library be used where it
 * suffices. ADR 027 set the precedent, rejecting a drag-and-drop library to
 * replace twenty lines that already worked.
 */

/**
 * Elements that can take focus. `[tabindex="-1"]` is deliberately excluded — it
 * is programmatically focusable but not part of the tab order, so including it
 * would make Tab visit things the user cannot reach anywhere else.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Both surface markers, so a Popover scopes the same way a Dialog does. */
const SURFACE_MARKER = '[data-tmui-panel],[data-tmui-surface]'

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // A node inside a nested surface belongs to that surface, not this one.
    (el) => el.closest(SURFACE_MARKER) === container
  )
}

/**
 * Cycle Tab and Shift+Tab within `container`.
 *
 * Returns true when it handled the key, so the caller knows to prevent the
 * default. Pure with respect to the event: it reads focus and moves it, and
 * decides nothing from anywhere else.
 */
export function trapTab(container: HTMLElement, shiftKey: boolean): boolean {
  const focusables = focusableWithin(container)
  if (focusables.length === 0) return false

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null

  if (shiftKey) {
    if (active === first || !container.contains(active)) {
      last.focus()
      return true
    }
    return false
  }

  if (active === last || !container.contains(active)) {
    first.focus()
    return true
  }
  return false
}

/**
 * Move focus into a freshly opened surface, and hand back the function that
 * returns it to wherever it was.
 *
 * The restore is idempotent and tolerates the opener having been removed from
 * the document in the meantime — a branch row that was deleted by the very
 * dialog confirming its deletion is the obvious case.
 */
export function captureFocus(container: HTMLElement): () => void {
  const opener = document.activeElement as HTMLElement | null
  const focusables = focusableWithin(container)
  // The close control sits first in DOM order but is the worst initial target:
  // a dialog should open on the safe action, which is what the core's own
  // confirm dialog did by focusing Cancel.
  const preferred =
    focusables.find((el) => el.hasAttribute('data-tmui-initial-focus')) ??
    focusables.find((el) => !el.hasAttribute('data-tmui-close')) ??
    focusables[0]
  ;(preferred ?? container).focus()

  let restored = false
  return () => {
    if (restored) return
    restored = true
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus()
  }
}
