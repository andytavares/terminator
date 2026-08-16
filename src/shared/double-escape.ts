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
