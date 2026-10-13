// Hooks and pieces shared by the docked panel (NotepadView) and a popped-out
// note window (NoteWindowView): comment card layout, scroll sync between the
// editor and the margin, and the controls that float over the editor.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { CommentMargin } from './CommentMargin'
import { CommentComposer } from './CommentComposer'
import {
  applyAnchors,
  scrollToAnchor,
  setEditorHoverAnchor,
  type SelectionAnchor,
} from '../editor/NoteEditor'
import { useCommentsStore } from '../stores/comments.store'
import { layoutCommentCards, reloadComments, visibleAnchors } from './noteComments'
import type { Comment } from '../db/types'

export type ViewRef = React.MutableRefObject<EditorView | null>
type PanelRef = React.RefObject<HTMLDivElement>

interface CardLayoutOptions {
  /** The open note; nothing is laid out while there is none. */
  noteId: string | null
  /** A margin to scroll level with the editor after each layout. */
  panelRef?: PanelRef
}

/** Re-applies the comment highlights and re-lays out the cards whenever the comments change. */
export function useCommentCards(viewRef: ViewRef, comments: Comment[], options: CardLayoutOptions) {
  const [anchorTops, setAnchorTops] = useState<Record<string, number>>({})
  const [panelContentHeight, setPanelContentHeight] = useState(0)
  const { noteId, panelRef } = options

  const relayout = useCallback(
    (view: EditorView, commentList: Comment[]) => {
      requestAnimationFrame(() => {
        const layout = layoutCommentCards(view, commentList)
        setAnchorTops(layout.tops)
        setPanelContentHeight(layout.contentHeight)
        if (panelRef?.current) panelRef.current.scrollTop = view.scrollDOM.scrollTop
      })
    },
    [panelRef]
  )

  useEffect(() => {
    const view = viewRef.current
    if (!view || !noteId) return
    applyAnchors(view, visibleAnchors(comments))
    relayout(view, comments)
  }, [comments, noteId, relayout]) // eslint-disable-line react-hooks/exhaustive-deps

  return { anchorTops, panelContentHeight }
}

/** Keeps the comment margin scrolled level with the editor while `key` is open. */
export function useMarginScrollSync(viewRef: ViewRef, panelRef: PanelRef, key: unknown): void {
  useEffect(() => {
    if (!key) return
    let removeScroll: (() => void) | undefined
    const t = setTimeout(() => {
      const view = viewRef.current
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
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

export interface CommentHover {
  id: string
  top: number
}

/** The "View comment" button over a highlighted anchor, which lingers briefly on leave. */
export function useCommentHover() {
  const [commentHover, setCommentHover] = useState<CommentHover | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHoverHide = useCallback(() => {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
  }, [])
  const scheduleHoverHide = useCallback(() => {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverHideTimer.current = setTimeout(() => setCommentHover(null), 200)
  }, [])
  useEffect(() => cancelHoverHide, [cancelHoverHide])

  return { commentHover, setCommentHover, cancelHoverHide, scheduleHoverHide }
}

type CommentHoverControls = ReturnType<typeof useCommentHover>

/** The comment id of the highlighted anchor under the pointer, if any. */
export function hoveredAnchor(e: React.MouseEvent<HTMLDivElement>) {
  const anchor = (e.target as HTMLElement).closest<HTMLElement>('[data-comment-id]')
  const id = anchor?.dataset.commentId
  return anchor && id ? { anchor, id } : null
}

/** Highlights at once, so React Strict Mode's double mount does not leave the second view bare:
 *  the anchors effect does not re-run when its dependencies are unchanged. */
export function applyStoredAnchors(view: EditorView): void {
  applyAnchors(view, visibleAnchors(useCommentsStore.getState().comments))
}

/** The selection a comment may be added to, and the one being commented on. */
export function useCommentDraft() {
  const [pendingAnchor, setPendingAnchor] = useState<SelectionAnchor | null>(null)
  const [composingAnchor, setComposingAnchor] = useState<SelectionAnchor | null>(null)
  const onSelectionChange = useCallback((sel: SelectionAnchor | null) => {
    setPendingAnchor(sel)
    if (!sel) setComposingAnchor(null)
  }, [])
  const startComposing = useCallback(() => {
    setComposingAnchor(pendingAnchor)
    setPendingAnchor(null)
  }, [pendingAnchor])
  return { pendingAnchor, composingAnchor, setComposingAnchor, onSelectionChange, startComposing }
}

type CommentDraft = ReturnType<typeof useCommentDraft>

interface EditorOverlayProps {
  draft: CommentDraft
  hover: CommentHoverControls
  onGoToComment: (id: string) => void
}

/** The add-comment button beside a selection, and the view-comment button over an anchor. */
export function EditorCommentOverlays(props: EditorOverlayProps): React.JSX.Element {
  const { draft, hover, onGoToComment } = props
  const { pendingAnchor, composingAnchor } = draft
  const { commentHover } = hover
  return (
    <>
      {pendingAnchor && !composingAnchor && (
        <button
          className="notepad-add-comment-btn"
          style={{ top: pendingAnchor.lineTop }}
          title="Add comment"
          onMouseDown={(e) => {
            e.preventDefault()
            draft.startComposing()
          }}
        >
          <MessageSquarePlus className="tm-icon" />
        </button>
      )}
      {commentHover && <ViewCommentButton hover={hover} onGoToComment={onGoToComment} />}
    </>
  )
}

function ViewCommentButton(props: Omit<EditorOverlayProps, 'draft'>): React.JSX.Element {
  const { hover, onGoToComment } = props
  const target = hover.commentHover
  return (
    <div
      className="notepad-comment-hover-btn"
      style={{ top: target?.top }}
      onMouseEnter={hover.cancelHoverHide}
      onMouseLeave={hover.scheduleHoverHide}
      onMouseDown={(e) => {
        e.preventDefault()
        if (target) onGoToComment(target.id)
      }}
    >
      View comment
    </div>
  )
}

interface CommentColumnProps {
  noteId: string
  draft: CommentDraft
  viewRef: ViewRef
  anchorTops: Record<string, number>
  containerHeight: number
  activeCommentId: string | null
}

/** The composer for a new comment, above the margin of existing ones. */
export function CommentColumn(props: CommentColumnProps): React.JSX.Element {
  const { noteId, draft, viewRef } = props
  return (
    <>
      {draft.composingAnchor && (
        <NewCommentComposer noteId={noteId} draft={draft} anchor={draft.composingAnchor} />
      )}
      <CommentMargin
        noteId={noteId}
        anchorTops={props.anchorTops}
        containerHeight={props.containerHeight}
        activeCommentId={props.activeCommentId}
        onCommentClick={(from, to) => scrollToAnchor(viewRef.current, from, to)}
        onHoverComment={(id) => setEditorHoverAnchor(viewRef.current, id)}
      />
    </>
  )
}

interface NewCommentComposerProps {
  noteId: string
  draft: CommentDraft
  anchor: SelectionAnchor
}

function NewCommentComposer({ noteId, draft, anchor }: NewCommentComposerProps) {
  const { from, to, quote, prefix, suffix } = anchor
  return (
    <CommentComposer
      anchor={{ noteId, from, to, quote, prefix, suffix }}
      onClose={() => draft.setComposingAnchor(null)}
      onCreated={() => {
        draft.setComposingAnchor(null)
        reloadComments(noteId)
      }}
    />
  )
}
