import React, { useState } from 'react'
import { RichContent } from './RichContent'
import { githubAPI } from '../../api/github'

interface NewCommentProps {
  repoRoot: string
  prNumber: number
  commitId: string
  path: string
  line: number
  startLine?: number
  side: 'LEFT' | 'RIGHT'
  onSubmitted: () => void
  onCancel: () => void
}

interface ReplyProps {
  repoRoot: string
  prNumber: number
  inReplyToId: number
  onSubmitted: () => void
  onCancel: () => void
}

type Props = NewCommentProps | ReplyProps

function isReply(p: Props): p is ReplyProps {
  return 'inReplyToId' in p
}

export function CommentComposer(props: Props) {
  const [body, setBody] = useState('')
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!body.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      if (isReply(props)) {
        const result = await githubAPI.prCommentReply({
          repoRoot: props.repoRoot,
          prNumber: props.prNumber,
          inReplyToId: props.inReplyToId,
          body,
        })
        if ('error' in result) throw new Error((result as { error: string }).error)
      } else {
        const result = await githubAPI.prCommentAdd({
          repoRoot: props.repoRoot,
          prNumber: props.prNumber,
          commitId: props.commitId,
          path: props.path,
          line: props.line,
          startLine: props.startLine,
          side: props.side,
          body,
        })
        if ('error' in result) throw new Error((result as { error: string }).error)
      }
      props.onSubmitted()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="comment-composer">
      <div className="comment-composer-tabs">
        <button
          className={`comment-composer-tab${tab === 'write' ? ' comment-composer-tab--active' : ''}`}
          onClick={() => setTab('write')}
        >
          Write
        </button>
        <button
          className={`comment-composer-tab${tab === 'preview' ? ' comment-composer-tab--active' : ''}`}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
      </div>

      {tab === 'write' ? (
        <textarea
          className="comment-composer-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a comment…"
          rows={4}
          disabled={submitting}
        />
      ) : (
        <div className="comment-composer-preview">
          {body.trim() ? <RichContent>{body}</RichContent> : <em>Nothing to preview.</em>}
        </div>
      )}

      {error && <p className="comment-composer-error">{error}</p>}

      <div className="comment-composer-actions">
        <button className="comment-composer-cancel" onClick={props.onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          className="comment-composer-submit"
          onClick={handleSubmit}
          disabled={submitting || !body.trim()}
        >
          {submitting ? 'Submitting…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}
