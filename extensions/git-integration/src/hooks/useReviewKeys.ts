import { useEffect, useRef } from 'react'
import { useReviewUiStore, REVIEW_KEY_EVENTS } from '../stores/review-ui.store'

export interface ReviewKeyHandlers {
  nextFile(): void
  prevFile(): void
  nextChapter(): void
  prevChapter(): void
  nextUnviewedFile(): void
  markViewed(): void
  toggleFileList?(): void
  toggleInsights(): void
  openSubmit(): void
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA'])

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (EDITABLE_TAGS.has(target.tagName)) return true
  return target.isContentEditable
}

type ReviewUi = ReturnType<typeof useReviewUiStore.getState>
type KeyAction = (handlers: ReviewKeyHandlers, ui: ReviewUi) => void

const G_D_WINDOW_MS = 1000

/** Raises a key event the diff pane performs, since only it knows its hunks and selection. */
function emit(event: string): KeyAction {
  return () => window.dispatchEvent(new CustomEvent(event))
}

const KEY_ACTIONS: Record<string, KeyAction> = {
  k: emit(REVIEW_KEY_EVENTS.nextHunk),
  j: emit(REVIEW_KEY_EVENTS.prevHunk),
  ']': (h) => h.nextFile(),
  '[': (h) => h.prevFile(),
  '}': (h) => h.nextChapter(),
  '{': (h) => h.prevChapter(),
  n: (h) => h.nextUnviewedFile(),
  v: (h) => h.markViewed(),
  s: (_h, ui) => ui.setDiffRange(ui.diffRange === 'since' ? 'whole' : 'since'),
  c: (_h, ui) => ui.cycleCommentVisibility(),
  C: (_h, ui) => ui.setAgentNotesOn(!ui.agentNotesOn),
  a: emit(REVIEW_KEY_EVENTS.askAgent),
  e: emit(REVIEW_KEY_EVENTS.explain),
  r: emit(REVIEW_KEY_EVENTS.comment),
  m: emit(REVIEW_KEY_EVENTS.note),
  t: (h, ui) => (h.toggleFileList ? h.toggleFileList() : ui.toggleFileList()),
  i: (h) => h.toggleInsights(),
  '?': (_h, ui) => ui.setKeyboardHelpOpen(!ui.keyboardHelpOpen),
}

/**
 * Handles the `g d` chord (peek definition): `g` starts it, `d` within a second ends it.
 * True when the key was part of the chord; any other key cancels a started one.
 */
function chordKey(key: string, gPressedAtRef: { current: number | null }): boolean {
  if (key === 'g') {
    gPressedAtRef.current = Date.now()
    return true
  }
  const started = gPressedAtRef.current
  gPressedAtRef.current = null
  if (key !== 'd' || !started || Date.now() - started > G_D_WINDOW_MS) return false
  window.dispatchEvent(new CustomEvent(REVIEW_KEY_EVENTS.peekDefinition))
  return true
}

/** Cmd+Enter (Ctrl+Enter off macOS) opens the submit panel. */
function isSubmitShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter'
}

function hasCommandModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey
}

function keyDownHandler(
  handlersRef: { current: ReviewKeyHandlers },
  gPressedAtRef: { current: number | null }
) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Escape' || isEditableTarget(e.target)) return
    if (isSubmitShortcut(e)) {
      e.preventDefault()
      handlersRef.current.openSubmit()
      return
    }
    // Every other binding is a bare key or shift+key — reject any other
    // modifier so OS/app shortcuts (Cmd+R, Ctrl+Tab, ...) pass through.
    if (hasCommandModifier(e)) return
    if (chordKey(e.key, gPressedAtRef)) return
    KEY_ACTIONS[e.key]?.(handlersRef.current, useReviewUiStore.getState())
  }
}

/**
 * Single-key bindings for the review surface (S3). Bound on window keydown
 * so it works no matter which pane has focus, but ignored while typing in an
 * input/textarea/contenteditable — and never binds Escape, which the
 * extension host uses to exit the extension on a double-press.
 */
export function useReviewKeys(handlers: ReviewKeyHandlers): void {
  const gPressedAtRef = useRef<number | null>(null)
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })
  useEffect(() => {
    const handleKeyDown = keyDownHandler(handlersRef, gPressedAtRef)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
