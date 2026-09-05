/**
 * Escape is claimed by extension UIs for their own dismissals (dropdowns,
 * inline renames, modals), so a single press cannot mean "leave the extension"
 * without stealing those. Two presses in quick succession is the exit gesture:
 * the first still reaches the extension, the second means the user pressed it
 * again because nothing visible happened.
 */
export const DOUBLE_ESCAPE_WINDOW_MS = 500

export interface DoubleEscapeDetector {
  /** Records an Escape at `now` (ms). Returns true when it completes a pair. */
  register(now: number): boolean
  reset(): void
}

export function createDoubleEscapeDetector(
  windowMs: number = DOUBLE_ESCAPE_WINDOW_MS
): DoubleEscapeDetector {
  let pendingAt: number | null = null

  return {
    register(now: number): boolean {
      const paired = pendingAt !== null && now - pendingAt < windowMs
      // Consuming the pending press means a third rapid Escape starts a fresh
      // pair rather than firing again off the second one.
      pendingAt = paired ? null : now
      return paired
    },
    reset(): void {
      pendingAt = null
    },
  }
}

// ── The guards ──────────────────────────────────────────────────────────────
//
// The pairing above says *when* two presses form the gesture. This says when the
// gesture must stand down, and it exists because that rule used to be written
// twice: once in the host window's `useExtensionEscapeExit`, which skipped
// terminals, text fields and open modals, and once inline in
// `preload-webview.ts`, which skipped nothing. The extension copy was the one
// users actually hit, so Escape twice while typing closed the extension and
// took the draft with it. One decision function now serves both.

export interface EscapeContext {
  /** Focus is inside a terminal, where Escape belongs to the shell. */
  inTerminal: boolean
  /** Focus is inside a text entry control, where Escape belongs to the field. */
  inTextField: boolean
  /** How many modal surfaces are open in this document. */
  modalDepth: number
}

/**
 * Whether the exit gesture must stand down. Pure: every input is a parameter,
 * nothing is read from the DOM or the clock.
 */
export function shouldSuppressExitGesture(context: EscapeContext): boolean {
  return context.inTerminal || context.inTextField || context.modalDepth > 0
}

/** Selector for the terminal surface, which owns Escape outright. */
const TERMINAL_SELECTOR = '.xterm'

/**
 * Derive the context from the element that received the keypress.
 *
 * `isContentEditable` is checked through the attribute as well as the property:
 * the property is unimplemented in jsdom, and a host that reports neither is
 * treated as "not a text field" rather than throwing.
 */
export function escapeContextFromTarget(target: unknown, modalDepth: number): EscapeContext {
  const el = target instanceof Element ? target : null
  const inTextField =
    el !== null &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      (el as HTMLElement).isContentEditable === true ||
      el.getAttribute('contenteditable') === 'true')

  return {
    inTerminal: el !== null && el.closest(TERMINAL_SELECTOR) !== null,
    inTextField,
    modalDepth,
  }
}
