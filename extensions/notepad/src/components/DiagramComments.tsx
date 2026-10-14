// The comment pins a diagram carries, and the popovers that read, reply to and
// add them.

import React, { useEffect, useRef, useState } from 'react'
import { MessageSquarePlus, X, Check, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import type { DiagramComment } from '../db/types'

/** Where on screen a pin or popover sits, relative to the canvas. */
export interface ScreenPoint {
  screenX: number
  screenY: number
}

interface CommentPinProps extends ScreenPoint {
  comment: DiagramComment
  isActive: boolean
  onClick: () => void
}

/** What can be done to an open comment thread. */
export interface ThreadActions {
  onReply: (body: string) => void
  onResolve: () => void
  onDelete: () => void
  onClose: () => void
}

interface CommentPopoverProps extends ScreenPoint {
  comment: DiagramComment
  actions: ThreadActions
}

interface CommentTextareaProps {
  placeholder: string
  rows: number
  value: string
  onChange: (value: string) => void
  /** Cmd/Ctrl+Enter. */
  onSend: () => void
  onEscape?: () => void
}

interface NewCommentComposerProps extends ScreenPoint {
  onSubmit: (body: string) => void
  onCancel: () => void
}

interface ComposerFooterProps {
  canSave: boolean
  onCancel: () => void
  onSave: () => void
}

export function CommentPin(props: CommentPinProps): React.JSX.Element {
  const { comment, screenX, screenY, isActive, onClick } = props
  const openCount = comment.replies.filter((r) => r.status === 'open').length + 1
  const className = isActive
    ? 'diagram-comment-pin diagram-comment-pin--active'
    : 'diagram-comment-pin'
  const label = 'Comment: ' + comment.body
  const hasReplies = openCount > 1
  return (
    <button
      aria-label={label}
      className={className}
      style={{ left: screenX, top: screenY }}
      onClick={onClick}
      title={comment.body}
    >
      <span className="diagram-comment-pin__icon">
        <MessageSquarePlus className="tm-icon" />
      </span>
      {hasReplies && <span className="diagram-comment-pin__count">{openCount}</span>}
    </button>
  )
}

/** True for Cmd/Ctrl+Enter, which sends from a comment box. */
function isSendChord(e: React.KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter'
}

export function CommentPopover(props: CommentPopoverProps): React.JSX.Element {
  const { comment, actions, screenX, screenY } = props
  return (
    <div className="diagram-comment-popover" style={{ left: screenX + 20, top: screenY }}>
      <div className="diagram-comment-popover__header">
        <span className="diagram-comment-popover__title">Comment</span>
        <div className="diagram-comment-popover__actions">
          <IconButton icon={Check} label="Resolve thread" size="sm" onClick={actions.onResolve} />
          <IconButton icon={Trash2} label="Delete thread" size="sm" onClick={actions.onDelete} />
          <IconButton icon={X} label="Close" size="sm" onClick={actions.onClose} />
        </div>
      </div>
      <div className="diagram-comment-popover__messages">
        {[comment, ...comment.replies].map((msg) => (
          <div key={msg.id} className="diagram-comment-popover__message">
            <span className="diagram-comment-popover__author">{msg.author}</span>
            <p className="diagram-comment-popover__body">{msg.body}</p>
          </div>
        ))}
      </div>
      <ReplyBox onReply={actions.onReply} />
    </div>
  )
}

/** A comment box that takes focus when it opens. */
function CommentTextarea(props: CommentTextareaProps): React.JSX.Element {
  const { onSend, onEscape } = props
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])
  return (
    <textarea
      ref={textareaRef}
      className="diagram-comment-popover__textarea"
      placeholder={props.placeholder}
      value={props.value}
      rows={props.rows}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onEscape?.()
        if (!isSendChord(e)) return
        e.preventDefault()
        onSend()
      }}
    />
  )
}

function ReplyBox({ onReply }: { onReply: (body: string) => void }): React.JSX.Element {
  const [replyText, setReplyText] = useState('')

  function submitReply() {
    const trimmed = replyText.trim()
    if (!trimmed) return
    onReply(trimmed)
    setReplyText('')
  }

  return (
    <div className="diagram-comment-popover__reply">
      <CommentTextarea
        placeholder="Reply…"
        rows={2}
        value={replyText}
        onChange={setReplyText}
        onSend={submitReply}
      />
      <Button
        variant="primary"
        size="sm"
        className="diagram-comment-popover__send"
        onClick={submitReply}
        disabled={!replyText.trim()}
      >
        Reply
      </Button>
    </div>
  )
}

export function NewCommentComposer(props: NewCommentComposerProps): React.JSX.Element {
  const { screenX, screenY, onSubmit, onCancel } = props
  const [body, setBody] = useState('')

  function submitNewComment() {
    const trimmed = body.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <div className="diagram-comment-popover" style={{ left: screenX + 20, top: screenY }}>
      <NewCommentHeader onCancel={onCancel} />
      <div className="diagram-comment-popover__reply">
        <CommentTextarea
          placeholder="Add a comment…"
          rows={3}
          value={body}
          onChange={setBody}
          onSend={submitNewComment}
          onEscape={onCancel}
        />
        <ComposerFooter canSave={!!body.trim()} onCancel={onCancel} onSave={submitNewComment} />
      </div>
    </div>
  )
}

function NewCommentHeader({ onCancel }: { onCancel: () => void }): React.JSX.Element {
  return (
    <div className="diagram-comment-popover__header">
      <span className="diagram-comment-popover__title">New comment</span>
      <IconButton icon={X} label="Cancel" size="sm" onClick={onCancel} />
    </div>
  )
}

function ComposerFooter({ canSave, onCancel, onSave }: ComposerFooterProps): React.JSX.Element {
  return (
    <div className="diagram-comment-popover__footer-actions">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="primary" size="sm" onClick={onSave} disabled={!canSave}>
        Save
      </Button>
    </div>
  )
}
