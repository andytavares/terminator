import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { applyAnchors } from '../editor/NoteEditor'
import { useCommentsStore } from '../stores/comments.store'
import { layoutCommentCards, visibleAnchors, type CardLayout } from './comment-anchors'
import type { Comment } from '../db/types'

interface CommentCards {
  /** The note's editor, once it has mounted. */
  editorViewRef: MutableRefObject<EditorView | null>
  /** For the editor's `onAnchorsReady`. */
  onEditorReady: (getView: () => EditorView | null) => void
  cards: CardLayout
  commentPanelRef: RefObject<HTMLDivElement>
}

/**
 * The comment margin beside a note's editor: highlights the comments' anchors,
 * lays their cards out level with them, and scrolls the margin with the editor.
 * `noteId` is the note shown, or null while none is.
 */
export function useCommentCards(comments: Comment[], noteId: string | null): CommentCards {
  const editorViewRef = useRef<EditorView | null>(null)
  const [cards, setCards] = useState<CardLayout>({ tops: {}, contentHeight: 0 })
  const commentPanelRef = useRef<HTMLDivElement>(null)

  // Re-apply anchors and lay the cards out again whenever the comments change
  useEffect(() => {
    const view = editorViewRef.current
    if (!view || !noteId) return
    applyAnchors(view, visibleAnchors(comments))
    const frame = requestAnimationFrame(() => {
      setCards(layoutCommentCards(view, comments))
      if (commentPanelRef.current) commentPanelRef.current.scrollTop = view.scrollDOM.scrollTop
    })
    return () => cancelAnimationFrame(frame)
  }, [comments, noteId])

  useEffect(() => syncMarginScroll(editorViewRef, commentPanelRef, noteId), [noteId])

  const onEditorReady = (getView: () => EditorView | null) => {
    const view = getView()
    editorViewRef.current = view
    // Apply anchors at once so React Strict Mode's double mount doesn't leave the
    // second view without highlights: the effect above won't re-run when its deps
    // haven't changed, but editorViewRef now holds a fresh view.
    if (view && noteId) applyAnchors(view, visibleAnchors(useCommentsStore.getState().comments))
  }

  return { editorViewRef, onEditorReady, cards, commentPanelRef }
}

/** Keeps the margin scrolled with the editor once both have mounted; returns the cleanup. */
function syncMarginScroll(
  editorViewRef: RefObject<EditorView | null>,
  panelRef: RefObject<HTMLDivElement>,
  noteId: string | null
): (() => void) | undefined {
  if (!noteId) return undefined
  let removeScroll: (() => void) | undefined
  const t = setTimeout(() => {
    const view = editorViewRef.current
    const panel = panelRef.current
    if (!view || !panel) return
    const onEditorScroll = () => {
      panel.scrollTop = view.scrollDOM.scrollTop
    }
    view.scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true })
    removeScroll = () => view.scrollDOM.removeEventListener('scroll', onEditorScroll)
  }, 100)
  return () => {
    clearTimeout(t)
    removeScroll?.()
  }
}
