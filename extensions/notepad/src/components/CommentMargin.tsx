import React, { useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useCommentsStore } from '../stores/comments.store'
import type { Comment } from '../db/types'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

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
  topOffset: number
  isActive?: boolean
  onCommentClick?: (from: number, to: number) => void
  onHoverComment?: (id: string | null) => void
}

function CommentCard({
  comment,
  noteId,
  topOffset,
  isActive,
  onCommentClick,
  onHoverComment,
}: CommentCardProps): React.JSX.Element {
  const { updateComment, removeComment } = useCommentsStore()
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)

  const isOrphaned = comment.status === 'orphaned'
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

  async function handleReply() {
    if (!replyBody.trim()) return
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:comments.reply',
        { noteId, parentId: comment.id, body: replyBody }
      )
      const data = (result as { data?: { id: string; createdAt: string } }).data
      if (data) {
        const newReply: Comment = {
          id: data.id,
          noteId,
          parentId: comment.id,
          body: replyBody,
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
        updateComment(comment.id, { replies: [...comment.replies, newReply] })
        setReplyBody('')
        setReplyOpen(false)
      }
    } catch (err) {
      console.error('[notepad] reply failed', err)
    }
  }

  const initial = (comment.author?.[0] ?? '?').toUpperCase()

  return (
    <div
      className={`notepad-comment${isOrphaned ? ' notepad-comment--orphaned' : ''}${isResolved ? ' notepad-comment--resolved' : ''}${isActive ? ' notepad-comment--active' : ''}`}
      style={{ position: 'absolute', top: topOffset, left: 8, right: 8 }}
      onMouseEnter={() => onHoverComment?.(comment.id)}
      onMouseLeave={() => onHoverComment?.(null)}
    >
      {/* Header: avatar + author + timestamp + delete */}
      <div className="notepad-comment__header">
        <div className="notepad-comment__avatar">{initial}</div>
        <span className="notepad-comment__author-name">{comment.author}</span>
        <span className="notepad-comment__timestamp">{relativeTime(comment.createdAt)}</span>
        <button
          className="notepad-comment__delete-btn"
          onClick={() => void handleDelete()}
          aria-label="Delete comment"
          title="Delete comment"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Quote anchor */}
      {comment.quote && (
        <button
          className="notepad-comment__quote"
          onClick={() => {
            if (comment.startOffset !== null && comment.endOffset !== null && !isOrphaned) {
              onCommentClick?.(comment.startOffset, comment.endOffset)
            }
          }}
          title="Click to jump to this text in the editor"
          disabled={isOrphaned}
        >
          &ldquo;{comment.quote.slice(0, 60)}
          {comment.quote.length > 60 ? '…' : ''}&rdquo;
        </button>
      )}

      {isOrphaned && (
        <div className="notepad-comment__orphan-label">
          <AlertTriangle size={12} />
          <span>Anchor lost</span>
        </div>
      )}

      {/* Body (click to edit) */}
      {editMode ? (
        <div className="notepad-comment__edit">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="notepad-comment__edit-input"
            aria-label="Edit comment"
          />
          <div className="notepad-comment__edit-actions">
            <button onClick={() => void handleSaveEdit()} className="notepad-comment__btn">
              Save
            </button>
            <button onClick={() => setEditMode(false)} className="notepad-comment__btn">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          className="notepad-comment__body"
          onClick={() => setEditMode(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setEditMode(true)}
          aria-label="Edit comment (click to edit)"
        >
          {comment.body}
        </div>
      )}

      {/* Inline replies */}
      {comment.replies.length > 0 && (
        <div className="notepad-comment__replies-inline">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="notepad-comment__reply-inline">
              <span className="notepad-comment__reply-arrow">↳</span>
              <span className="notepad-comment__reply-label">reply:</span>
              <span className="notepad-comment__reply-text">{reply.body}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reply compose form */}
      {replyOpen && (
        <div className="notepad-comment__reply-form">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a reply…"
            className="notepad-comment__reply-input"
          />
          <button onClick={() => void handleReply()} className="notepad-comment__btn">
            Send
          </button>
        </div>
      )}

      {/* Footer: Reply | Resolve text links */}
      <div className="notepad-comment__actions-row">
        {!isOrphaned && (
          <button className="notepad-comment__action-link" onClick={() => setReplyOpen((v) => !v)}>
            Reply
          </button>
        )}
        <button
          className={`notepad-comment__action-link${isResolved ? ' notepad-comment__action-link--active' : ''}`}
          onClick={() => void handleResolve()}
          title={isResolved ? 'Unresolve' : 'Resolve'}
        >
          {isResolved ? 'Unresolve' : 'Resolve'}
        </button>
      </div>
    </div>
  )
}

export function CommentMargin({
  noteId,
  anchorTops,
  containerHeight,
  activeCommentId,
  onCommentClick,
  onHoverComment,
}: CommentMarginProps): React.JSX.Element {
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
        <div
          className="notepad-comment-margin"
          style={{
            minHeight: containerHeight && containerHeight > 0 ? containerHeight : undefined,
          }}
        >
          {rootComments.map((comment) => {
            const topOffset = anchorTops[comment.id] ?? 0
            return (
              <CommentCard
                key={comment.id}
                comment={comment}
                noteId={noteId}
                topOffset={topOffset}
                isActive={activeCommentId === comment.id}
                onCommentClick={onCommentClick}
                onHoverComment={onHoverComment}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
