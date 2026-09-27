import React, { useState } from 'react'
import { RichContent } from './RichContent'
import { githubAPI } from '../../api/github'
import { usePrReviewStore } from '../../stores/pr-review.store'

interface NewCommentProps {
  repoRoot: string
  prNumber: number
  commitId: string
  path: string
  line: number
  startLine?: number
  side: 'LEFT' | 'RIGHT'
  initialBody?: string
  fromFindingId?: string | null
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
  const [body, setBody] = useState(isReply(props) ? '' : (props.initialBody ?? ''))
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const addDraft = usePrReviewStore((s) => s.addDraft)

  const handleSubmit = async () => {
    if (!body.trim()) return
    if (isReply(props)) {
      setSubmitting(true)
      setError(null)
      try {
        const result = await githubAPI.prCommentReply({
          repoRoot: props.repoRoot,
          prNumber: props.prNumber,
          inReplyToId: props.inReplyToId,
          body,
        })
        if ('error' in result) throw new Error((result as { error: string }).error)
        props.onSubmitted()
      } catch (e) {
        setError(String(e))
      } finally {
        setSubmitting(false)
      }
      return
    }
    addDraft(props.repoRoot, props.prNumber, props.commitId, {
      id: crypto.randomUUID(),
      path: props.path,
      line: props.line,
      startLine: props.startLine ?? null,
      side: props.side,
      body,
      fromFindingId: props.fromFindingId ?? null,
    })
    props.onSubmitted()
  }

  return (
    <div className="comment-composer" data-testid="composer">
      {!isReply(props) && (
        <div className="rs-thread-th">
          <span className="rs-av">A</span>New comment · line {props.line}
          {props.fromFindingId ? ' · edited from agent finding' : ''}
        </div>
      )}
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
          {isReply(props) ? (submitting ? 'Submitting…' : 'Reply') : 'Add to pending review'}
        </button>
        {!isReply(props) && <span className="rs-note">Sent when you submit your review</span>}
      </div>
    </div>
  )
}
