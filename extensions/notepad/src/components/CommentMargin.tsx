import React, { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import { useCommentsStore } from '../stores/comments.store'
import type { Comment } from '../db/types'

interface CommentMarginProps {
  noteId: string
  anchorTops: Record<string, number>
  containerHeight?: number
  activeCommentId?: string | null
  onCommentClick?: (from: number, to: number) => void
  onHoverComment?: (id: string | null) => void
}

interface CommentCardProps {
  comment: Comment
  noteId: string
  topOffset?: number
  isActive?: boolean
  positioned?: boolean
  onCommentClick?: (from: number, to: number) => void
  onHoverComment?: (id: string | null) => void
}

interface MarginSectionProps {
  rootComments: Comment[]
  margin: CommentMarginProps
}

interface CommentQuoteProps {
  comment: Comment
  onCommentClick?: (from: number, to: number) => void
}

interface CommentActionProps {
  comment: Comment
  actions: CommentActions
}

/** A comment's edit and reply drafts, and what the card does with them. */
type CommentActions = ReturnType<typeof useCommentActions>

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function cardClassName(comment: Comment, isActive: boolean | undefined): string {
  const modifiers = [
    comment.status === 'orphaned' && ' notepad-comment--orphaned',
    comment.status === 'resolved' && ' notepad-comment--resolved',
    isActive && ' notepad-comment--active',
  ]
  return 'notepad-comment' + modifiers.filter(Boolean).join('')
}

function CommentCard(props: CommentCardProps): React.JSX.Element {
  const { comment, topOffset, isActive, positioned = true, onHoverComment } = props
  const actions = useCommentActions(comment, props.noteId)
  const isOrphaned = comment.status === 'orphaned'

  const style: React.CSSProperties = positioned
    ? { position: 'absolute', top: topOffset ?? 0, left: 8, right: 8 }
    : {}

  return (
    <div
      className={cardClassName(comment, isActive)}
      style={style}
      onMouseEnter={() => onHoverComment?.(comment.id)}
      onMouseLeave={() => onHoverComment?.(null)}
    >
      <CommentCardHeader comment={comment} onDelete={() => void actions.handleDelete()} />
      {comment.quote && !isOrphaned && (
        <CommentQuote comment={comment} onCommentClick={props.onCommentClick} />
      )}
      <CommentBody comment={comment} actions={actions} />
      <InlineReplies replies={comment.replies} />
      {actions.replyOpen && <ReplyForm actions={actions} />}
      {!isOrphaned && <CommentFooter comment={comment} actions={actions} />}
    </div>
  )
}

function useCommentActions(comment: Comment, noteId: string) {
  return {
    ...useCommentStatus(comment),
    ...useCommentEdit(comment),
    ...useCommentReply(comment, noteId),
  }
}

/** Resolving and deleting a comment. */
function useCommentStatus(comment: Comment) {
  const { updateComment, removeComment } = useCommentsStore()
  const isResolved = comment.status === 'resolved'

  async function handleResolve() {
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:comments.resolve',
        { id: comment.id, resolved: !isResolved }
      )
      const data = (result as { data?: { status: string } }).data
      if (data) updateComment(comment.id, { status: data.status as Comment['status'] })
    } catch (err) {
      console.error('[notepad] resolve failed', err)
    }
  }

  async function handleDelete() {
    try {
      await window.electronAPI.extensionBridge.invoke('terminator.notepad:comments.delete', {
        id: comment.id,
      })
      removeComment(comment.id)
    } catch (err) {
      console.error('[notepad] delete failed', err)
    }
  }

  return { handleResolve, handleDelete }
}

function useCommentEdit(comment: Comment) {
  const { updateComment } = useCommentsStore()
  const [editMode, setEditMode] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)

  async function handleSaveEdit() {
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:comments.update',
        { id: comment.id, body: editBody }
      )
      if ((result as { data?: unknown }).data) {
        updateComment(comment.id, { body: editBody })
        setEditMode(false)
      }
    } catch (err) {
      console.error('[notepad] update failed', err)
    }
  }

  return { editMode, setEditMode, editBody, setEditBody, handleSaveEdit }
}

function useCommentReply(comment: Comment, noteId: string) {
  const { updateComment } = useCommentsStore()
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')

  async function handleReply() {
    if (!replyBody.trim()) return
    try {
      const reply = await sendReply(comment, { noteId, body: replyBody })
      if (!reply) return
      updateComment(comment.id, { replies: [...comment.replies, reply] })
      setReplyBody('')
      setReplyOpen(false)
    } catch (err) {
      console.error('[notepad] reply failed', err)
    }
  }

  return { replyOpen, setReplyOpen, replyBody, setReplyBody, handleReply }
}

/** Posts a reply; resolves to the reply as the store keeps it, or null when none was made. */
async function sendReply(
  parent: Comment,
  reply: { noteId: string; body: string }
): Promise<Comment | null> {
  const result = await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:comments.reply',
    { noteId: reply.noteId, parentId: parent.id, body: reply.body }
  )
  const data = (result as { data?: { id: string; createdAt: string } }).data
  if (!data) return null
  return {
    id: data.id,
    noteId: reply.noteId,
    parentId: parent.id,
    body: reply.body,
    author: 'me',
    status: 'open',
    startOffset: null,
    endOffset: null,
    quote: null,
    prefix: null,
    suffix: null,
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
    replies: [],
  }
}

/** Avatar, author, timestamp and delete. */
function CommentCardHeader(props: { comment: Comment; onDelete: () => void }) {
  const { comment, onDelete } = props
  const initial = (comment.author?.[0] ?? '?').toUpperCase()
  return (
    <div className="notepad-comment__header">
      <div className="notepad-comment__avatar">{initial}</div>
      <span className="notepad-comment__author-name">{comment.author}</span>
      <span className="notepad-comment__timestamp">{relativeTime(comment.createdAt)}</span>
      <IconButton
        icon={Trash2}
        label="Delete comment"
        size="sm"
        className="notepad-comment__delete-btn"
        onClick={onDelete}
      />
    </div>
  )
}

function CommentQuote({ comment, onCommentClick }: CommentQuoteProps): React.JSX.Element {
  const quote = comment.quote ?? ''
  const jumpToQuote = () => {
    if (comment.startOffset !== null && comment.endOffset !== null) {
      onCommentClick?.(comment.startOffset, comment.endOffset)
    }
  }
  return (
    <button
      className="notepad-comment__quote"
      onClick={jumpToQuote}
      title="Click to jump to this text in the editor"
    >
      &ldquo;{quote.slice(0, 60)}
      {quote.length > 60 ? '…' : ''}&rdquo;
    </button>
  )
}

function CommentBody({ comment, actions }: CommentActionProps): React.JSX.Element {
  const editable = comment.status !== 'resolved'
  if (actions.editMode) return <CommentEditor actions={actions} />
  return (
    <div
      className="notepad-comment__body"
      onClick={() => editable && actions.setEditMode(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && editable && actions.setEditMode(true)}
      aria-label="Edit comment (click to edit)"
    >
      {comment.body}
    </div>
  )
}

function CommentEditor({ actions }: { actions: CommentActions }): React.JSX.Element {
  return (
    <div className="notepad-comment__edit">
      <textarea
        value={actions.editBody}
        onChange={(e) => actions.setEditBody(e.target.value)}
        className="notepad-comment__edit-input"
        aria-label="Edit comment"
      />
      <div className="notepad-comment__edit-actions">
        <Button variant="primary" size="sm" onClick={() => void actions.handleSaveEdit()}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => actions.setEditMode(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function InlineReplies({ replies }: { replies: Comment[] }): React.JSX.Element | null {
  if (replies.length === 0) return null
  return (
    <div className="notepad-comment__replies-inline">
      {replies.map((reply) => (
        <div key={reply.id} className="notepad-comment__reply-inline">
          <span className="notepad-comment__reply-arrow">↳</span>
          <span className="notepad-comment__reply-label">reply:</span>
          <span className="notepad-comment__reply-text">{reply.body}</span>
        </div>
      ))}
    </div>
  )
}

function ReplyForm({ actions }: { actions: CommentActions }): React.JSX.Element {
  return (
    <div className="notepad-comment__reply-form">
      <textarea
        value={actions.replyBody}
        onChange={(e) => actions.setReplyBody(e.target.value)}
        placeholder="Write a reply…"
        className="notepad-comment__reply-input"
      />
      <Button variant="primary" size="sm" onClick={() => void actions.handleReply()}>
        Send
      </Button>
    </div>
  )
}

function CommentFooter({ comment, actions }: CommentActionProps): React.JSX.Element {
  const isResolved = comment.status === 'resolved'
  return (
    <div className="notepad-comment__actions-row">
      {!isResolved && (
        <Button variant="ghost" size="sm" onClick={() => actions.setReplyOpen((v) => !v)}>
          Reply
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => void actions.handleResolve()}>
        {isResolved ? 'Unresolve' : 'Resolve'}
      </Button>
    </div>
  )
}

export function CommentMargin(props: CommentMarginProps): React.JSX.Element {
  const { comments } = useCommentsStore()
  const rootComments = comments.filter((c) => c.parentId === null)
  const openCount = rootComments.filter((c) => c.status === 'open').length

  return (
    <div className="notepad-comment-column">
      <div className="notepad-comment-column__header">
        <span className="notepad-comment-column__title">Comments</span>
        {openCount > 0 && <span className="notepad-comment-column__badge">{openCount} open</span>}
      </div>

      {rootComments.length === 0 ? (
        <div className="notepad-comment-margin notepad-comment-margin--empty">
          <p className="notepad-comment-margin__hint">Select text and click + to add a comment</p>
        </div>
      ) : (
        <>
          <UnanchoredSections rootComments={rootComments} margin={props} />
          <AnchoredComments rootComments={rootComments} margin={props} />
        </>
      )}
    </div>
  )
}

// Orphaned + resolved sit in a sticky block above the scroll-synced zone
// so they remain visible regardless of editor scroll position.
function UnanchoredSections({ rootComments, margin }: MarginSectionProps) {
  const orphaned = rootComments.filter((c) => c.status === 'orphaned')
  const resolved = rootComments.filter((c) => c.status === 'resolved')
  if (orphaned.length === 0 && resolved.length === 0) return null
  return (
    <div className="notepad-comment-static-sections">
      {orphaned.length > 0 && (
        <div className="notepad-comment-orphaned-section">
          <div className="notepad-comment-orphaned-header">
            <AlertTriangle className="tm-icon" />
            <span>Orphaned ({orphaned.length})</span>
          </div>
          <StaticCards comments={orphaned} margin={margin} />
        </div>
      )}
      {resolved.length > 0 && <ResolvedSection resolved={resolved} margin={margin} />}
    </div>
  )
}

function ResolvedSection(props: { resolved: Comment[]; margin: CommentMarginProps }) {
  const { resolved, margin } = props
  const [showResolved, setShowResolved] = useState(false)
  const Chevron = showResolved ? ChevronDown : ChevronRight
  return (
    <div className="notepad-comment-resolved-section">
      <button
        type="button"
        className="notepad-comment-resolved-toggle"
        aria-expanded={showResolved}
        onClick={() => setShowResolved((v) => !v)}
      >
        <Chevron aria-hidden="true" className="tm-icon-sm" />
        {resolved.length} resolved
      </button>
      {showResolved && <StaticCards comments={resolved} margin={margin} />}
    </div>
  )
}

/** Cards that stay in the sticky block rather than beside their anchors. */
function StaticCards(props: { comments: Comment[]; margin: CommentMarginProps }) {
  const { comments, margin } = props
  return (
    <>
      {comments.map((comment) => (
        <CommentCard
          key={comment.id}
          comment={comment}
          noteId={margin.noteId}
          positioned={false}
          isActive={margin.activeCommentId === comment.id}
        />
      ))}
    </>
  )
}

/** Anchored open comments — absolutely positioned, scroll-synced with editor. */
function AnchoredComments({ rootComments, margin }: MarginSectionProps): React.JSX.Element {
  const { containerHeight, anchorTops } = margin
  return (
    <div
      className="notepad-comment-margin"
      style={{
        minHeight: containerHeight && containerHeight > 0 ? containerHeight : undefined,
      }}
    >
      {rootComments
        .filter((c) => c.status === 'open')
        .map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            noteId={margin.noteId}
            topOffset={anchorTops[comment.id] ?? 0}
            positioned
            isActive={margin.activeCommentId === comment.id}
            onCommentClick={margin.onCommentClick}
            onHoverComment={margin.onHoverComment}
          />
        ))}
    </div>
  )
}
