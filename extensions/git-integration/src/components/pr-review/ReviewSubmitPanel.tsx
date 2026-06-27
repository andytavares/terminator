import React, { useState } from 'react'
import { githubAPI } from '../../api/github'

interface Props {
  repoRoot: string
  prNumber: number
  isOwnPr?: boolean
  onClose: () => void
}

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export function ReviewSubmitPanel({ repoRoot, prNumber, isOwnPr, onClose }: Props) {
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (event !== 'APPROVE' && !body.trim()) {
      setError('A comment body is required for this review type.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await githubAPI.prReviewSubmit({
        repoRoot,
        prNumber,
        event,
        body,
      })
      if ('error' in result) throw new Error((result as { error: string }).error)
      setSubmitted(true)
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="review-submit-success">
        <p>Review submitted successfully.</p>
        <button onClick={onClose}>Close</button>
      </div>
    )
  }

  return (
    <div className="review-submit-panel">
      <h2 className="review-submit-heading">Submit review</h2>

      {isOwnPr && (
        <p className="review-submit-own-pr-notice">
          You cannot approve or request changes on your own pull request.
        </p>
      )}
      <div className="review-submit-options" role="radiogroup" aria-label="Review outcome">
        {(
          [
            ['APPROVE', 'Approve'],
            ['REQUEST_CHANGES', 'Request changes'],
            ['COMMENT', 'Comment'],
          ] as const
        ).map(([val, label]) => {
          const blocked = isOwnPr && (val === 'APPROVE' || val === 'REQUEST_CHANGES')
          return (
            <label
              key={val}
              className={`review-submit-option review-submit-option--${val.toLowerCase().replace('_', '-')}${event === val ? ' review-submit-option--selected' : ''}${blocked ? ' review-submit-option--disabled' : ''}`}
            >
              <input
                type="radio"
                name="review-event"
                value={val}
                checked={event === val}
                disabled={blocked}
                onChange={() => !blocked && setEvent(val)}
              />
              {label}
            </label>
          )
        })}
      </div>

      <textarea
        className="review-submit-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a summary comment (optional)…"
        rows={5}
        disabled={submitting}
      />

      {error && <p className="review-submit-error">{error}</p>}

      <div className="review-submit-actions">
        <button className="review-submit-cancel" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button className="review-submit-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
    </div>
  )
}
