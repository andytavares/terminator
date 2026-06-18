import React, { useState } from 'react'
import {
  CheckCircle,
  Circle,
  Trash2,
  MessageSquare,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useCommentsStore } from '../stores/comments.store'
import type { Comment } from '../db/types'

interface CommentMarginProps {
  noteId: string
  anchorTops: Record<string, number>
  containerHeight: number
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
  const [repliesOpen, setRepliesOpen] = useState(true)

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

  async function handleEdit() {
    if (!editMode) {
      setEditMode(true)
      return
    }
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

  function handleQuoteClick() {
    if (comment.startOffset !== null && comment.endOffset !== null && !isOrphaned) {
      onCommentClick?.(comment.startOffset, comment.endOffset)
    }
  }

  return (
    <div
      className={`notepad-comment${isOrphaned ? ' notepad-comment--orphaned' : ''}${isResolved ? ' notepad-comment--resolved' : ''}${isActive ? ' notepad-comment--active' : ''}`}
      style={{ position: 'absolute', top: topOffset, left: 8, right: 8 }}
      onMouseEnter={() => onHoverComment?.(comment.id)}
      onMouseLeave={() => onHoverComment?.(null)}
    >
      {comment.quote && (
        <button
          className="notepad-comment__quote"
          onClick={handleQuoteClick}
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

      {editMode ? (
        <div className="notepad-comment__edit">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="notepad-comment__edit-input"
            aria-label="Edit comment"
          />
          <div className="notepad-comment__edit-actions">
            <button onClick={() => void handleEdit()} className="notepad-comment__btn">
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

      <div className="notepad-comment__footer">
        <span className="notepad-comment__author">{comment.author}</span>
        <div className="notepad-comment__actions">
          <button
            onClick={() => void handleResolve()}
            className="notepad-comment__icon-btn"
            aria-label={isResolved ? 'Unresolve' : 'Resolve'}
            title={isResolved ? 'Unresolve' : 'Resolve'}
          >
            {isResolved ? <CheckCircle size={14} /> : <Circle size={14} />}
          </button>
          {!isOrphaned && (
            <button
              onClick={() => setReplyOpen((v) => !v)}
              className="notepad-comment__icon-btn"
              aria-label="Reply"
              title="Reply"
            >
              <MessageSquare size={14} />
            </button>
          )}
          <button
            onClick={() => void handleDelete()}
            className="notepad-comment__icon-btn notepad-comment__icon-btn--delete"
            aria-label="Delete comment"
            title="Delete comment"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

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

      {comment.replies.length > 0 && (
        <div className="notepad-comment__replies">
          <button
            className="notepad-comment__replies-toggle"
            onClick={() => setRepliesOpen((v) => !v)}
          >
            {repliesOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span>
              {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
            </span>
          </button>
          {repliesOpen &&
            comment.replies.map((reply) => (
              <div key={reply.id} className="notepad-comment__reply">
                <div className="notepad-comment__body">{reply.body}</div>
                <span className="notepad-comment__author">{reply.author}</span>
              </div>
            ))}
        </div>
      )}
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

  if (rootComments.length === 0) {
    return (
      <div className="notepad-comment-margin notepad-comment-margin--empty">
        <p className="notepad-comment-margin__hint">Select text and click + to add a comment</p>
      </div>
    )
  }

  return (
    <div
      className="notepad-comment-margin"
      style={{ minHeight: containerHeight > 0 ? containerHeight : undefined }}
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
  )
}
