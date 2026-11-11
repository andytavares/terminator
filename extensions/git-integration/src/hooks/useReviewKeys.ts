import { useEffect, useRef } from 'react'
import { REVIEW_KEY_EVENTS } from '../stores/review-ui.store'

export interface ReviewKeyHandlers {
  focusVerdictBar(): void
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA'])

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (EDITABLE_TAGS.has(target.tagName)) return true
  return target.isContentEditable
}

/** Controls that Space activates; Space there belongs to the control, not the review. */
const SPACE_CONTROLS =
  'button, a[href], select, summary, [role="button"], [role="checkbox"], [role="switch"], [role="tab"]'

function isSpaceOnControl(e: KeyboardEvent): boolean {
  return e.key === ' ' && e.target instanceof Element && e.target.closest(SPACE_CONTROLS) !== null
}

/** The pane event each bare key raises, since only the pane knows its hunks and selection. */
const KEY_EVENTS: Record<string, string> = {
  k: REVIEW_KEY_EVENTS.nextHunk,
  j: REVIEW_KEY_EVENTS.prevHunk,
  ' ': REVIEW_KEY_EVENTS.markHunkRead,
  c: REVIEW_KEY_EVENTS.comment,
  l: REVIEW_KEY_EVENTS.later,
}

/** Cmd+Enter (Ctrl+Enter off macOS) moves to the verdict bar. */
function isSubmitShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter'
}

function hasCommandModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey
}

function keyDownHandler(handlersRef: { current: ReviewKeyHandlers }) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Escape' || isEditableTarget(e.target)) return
    if (isSubmitShortcut(e)) {
      e.preventDefault()
      handlersRef.current.focusVerdictBar()
      return
    }
    // Every other binding is a bare key — reject any modifier so OS/app
    // shortcuts (Cmd+R, Ctrl+Tab, ...) pass through.
    if (hasCommandModifier(e) || isSpaceOnControl(e)) return
    const event = KEY_EVENTS[e.key]
    if (!event) return
    // Space would otherwise scroll the pane as well.
    e.preventDefault()
    window.dispatchEvent(new CustomEvent(event))
  }
}

/**
 * Single-key bindings for the review surface (S3). Bound on window keydown
 * so it works no matter which pane has focus, but ignored while typing in an
 * input/textarea/contenteditable — and never binds Escape, which the
 * extension host uses to exit the extension on a double-press.
 */
export function useReviewKeys(handlers: ReviewKeyHandlers): void {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })
  useEffect(() => {
    const handleKeyDown = keyDownHandler(handlersRef)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
