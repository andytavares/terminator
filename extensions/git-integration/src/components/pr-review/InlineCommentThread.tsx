import React, { useState } from 'react'
import { Button, RelativeTime } from '@terminator/extension-ui'
import type { Thread } from '../../schemas/pr-review.schema'
import { RichContent } from './RichContent'
import './inline-comment.css'

interface Props {
  thread: Thread
  onReply?: (threadId: string) => void
}

type ThreadComment = Thread['comments'][number]

function threadClass(thread: Thread): string {
  const outdated = thread.outdated ? ' inline-comment-thread--outdated' : ''
  const resolved = thread.resolved ? ' inline-comment-thread--resolved rs-thread--resolved' : ''
  return `inline-comment-thread${outdated}${resolved}`
}

function ThreadCommentItem({ comment, resolved }: { comment: ThreadComment; resolved: boolean }) {
  return (
    <div className={`inline-comment${comment.isReply ? ' inline-comment--reply' : ''}`}>
      <img
        src={comment.authorAvatarUrl}
        alt={comment.author}
        className="inline-comment-avatar"
        width={22}
        height={22}
      />
      <div>
        <div className="inline-comment-header">
          <strong className="inline-comment-author">{comment.author}</strong>
          {resolved && <span className="inline-comment-resolved-label">Resolved</span>}
          <RelativeTime value={comment.createdAt} />
        </div>
        <div className="inline-comment-body">
          <RichContent>{comment.body}</RichContent>
        </div>
      </div>
    </div>
  )
}

export function InlineCommentThread({ thread, onReply }: Props) {
  const [expanded, setExpanded] = useState(!thread.collapsed)
  const visibleComments = expanded ? thread.comments : thread.comments.slice(0, 1)
  const hiddenCount = thread.comments.length - 1
  return (
    <div className={threadClass(thread)}>
      {thread.outdated && <span className="inline-comment-outdated-label">Outdated</span>}
      {visibleComments.map((comment) => (
        <ThreadCommentItem key={comment.id} comment={comment} resolved={!!thread.resolved} />
      ))}
      {!expanded && hiddenCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          Show {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
        </Button>
      )}
      {onReply && (
        <div className="inline-comment-reply">
          <button
            type="button"
            className="inline-comment-reply-field"
            onClick={() => onReply(thread.id)}
          >
            Reply<span aria-hidden="true">…</span>
          </button>
        </div>
      )}
    </div>
  )
}
