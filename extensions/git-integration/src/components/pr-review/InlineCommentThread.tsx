import React, { useState } from 'react'
import type { Thread } from '../../schemas/pr-review.schema'
import { RichContent } from './RichContent'

interface Props {
  thread: Thread
  onReply?: (threadId: string) => void
}

export function InlineCommentThread({ thread, onReply }: Props) {
  const [expanded, setExpanded] = useState(!thread.collapsed)

  const visibleComments = expanded ? thread.comments : thread.comments.slice(0, 1)
  const hiddenCount = thread.comments.length - 1

  return (
    <div className={`inline-comment-thread${thread.outdated ? ' inline-comment-thread--outdated' : ''}`}>
      {thread.outdated && (
        <span className="inline-comment-outdated-label">Outdated</span>
      )}

      {visibleComments.map(comment => (
        <div key={comment.id} className={`inline-comment${comment.isReply ? ' inline-comment--reply' : ''}`}>
          <div className="inline-comment-header">
            <img
              src={comment.authorAvatarUrl}
              alt={comment.author}
              className="inline-comment-avatar"
              width={20}
              height={20}
            />
            <strong className="inline-comment-author">{comment.author}</strong>
            <time className="inline-comment-time" dateTime={comment.createdAt}>
              {formatTime(comment.createdAt)}
            </time>
          </div>
          <div className="inline-comment-body">
            <RichContent>{comment.body}</RichContent>
          </div>
        </div>
      ))}

      {!expanded && hiddenCount > 0 && (
        <button className="inline-comment-expand" onClick={() => setExpanded(true)}>
          Show {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {onReply && (
        <button className="inline-comment-reply-btn" onClick={() => onReply(thread.id)}>
          Reply
        </button>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
