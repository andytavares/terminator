import { useEffect, useRef } from 'react'
import { useReviewUiStore, REVIEW_KEY_EVENTS } from '../stores/review-ui.store'

export interface ReviewKeyHandlers {
  nextFile(): void
  prevFile(): void
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

/**
 * Single-key bindings for the review surface (S3). Bound on window keydown
 * so it works no matter which pane has focus, but ignored while typing in an
 * input/textarea/contenteditable — and never binds Escape, which the
 * extension host uses to exit the extension on a double-press.
 */
export function useReviewKeys(handlers: ReviewKeyHandlers): void {
  const gPressedAtRef = useRef<number | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return
      if (isEditableTarget(e.target)) return

      const isCmdEnter = (e.metaKey || e.ctrlKey) && e.key === 'Enter'
      if (isCmdEnter) {
        e.preventDefault()
        handlers.openSubmit()
        return
      }

      // Every other binding is a bare key or shift+key — reject any other
      // modifier so OS/app shortcuts (Cmd+R, Ctrl+Tab, ...) pass through.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key

      if (key === 'g') {
        gPressedAtRef.current = Date.now()
        return
      }
      if (key === 'd' && gPressedAtRef.current && Date.now() - gPressedAtRef.current <= 1000) {
        gPressedAtRef.current = null
        window.dispatchEvent(new CustomEvent(REVIEW_KEY_EVENTS.peekDefinition))
        return
      }
      gPressedAtRef.current = null

      const ui = useReviewUiStore.getState()

      switch (key) {
        case 'k':
          window.dispatchEvent(new CustomEvent(REVIEW_KEY_EVENTS.nextHunk))
          return
        case 'j':
          window.dispatchEvent(new CustomEvent(REVIEW_KEY_EVENTS.prevHunk))
          return
        case ']':
          handlers.nextFile()
          return
        case '[':
          handlers.prevFile()
          return
        case 'n':
          handlers.nextUnviewedFile()
          return
        case 'v':
          handlers.markViewed()
          return
        case 's':
          ui.setDiffRange(ui.diffRange === 'since' ? 'whole' : 'since')
          return
        case 'c':
          ui.cycleCommentVisibility()
          return
        case 'C':
          ui.setAgentNotesOn(!ui.agentNotesOn)
          return
        case 'a':
          window.dispatchEvent(new CustomEvent(REVIEW_KEY_EVENTS.askAgent))
          return
        case 'e':
          window.dispatchEvent(new CustomEvent(REVIEW_KEY_EVENTS.explain))
          return
        case 'r':
          window.dispatchEvent(new CustomEvent(REVIEW_KEY_EVENTS.comment))
          return
        case 'm':
          window.dispatchEvent(new CustomEvent(REVIEW_KEY_EVENTS.note))
          return
        case 't':
          if (handlers.toggleFileList) handlers.toggleFileList()
          else ui.toggleFileList()
          return
        case 'i':
          handlers.toggleInsights()
          return
        case '?':
          ui.setKeyboardHelpOpen(!ui.keyboardHelpOpen)
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlers])
}
