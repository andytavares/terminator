import React, { useState } from 'react'

interface Props {
  repoRoot: string
  prNumber: number
  commitId: string
  onClose: () => void
}

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export function ReviewSubmitPanel({ repoRoot, prNumber, commitId, onClose }: Props) {
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const result = await window.electronAPI.github.prReviewSubmit({
        repoRoot,
        prNumber,
        commitId,
        event,
        body,
      })
      if ('error' in result) throw new Error((result as { error: string }).error)
      setSubmitted(true)
    } catch (e) {
      setError(String(e))
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

      <div className="review-submit-options" role="radiogroup" aria-label="Review outcome">
        {(
          [
            ['APPROVE', 'Approve'],
            ['REQUEST_CHANGES', 'Request changes'],
            ['COMMENT', 'Comment'],
          ] as const
        ).map(([val, label]) => (
          <label
            key={val}
            className={`review-submit-option review-submit-option--${val.toLowerCase().replace('_', '-')}${event === val ? ' review-submit-option--selected' : ''}`}
          >
            <input
              type="radio"
              name="review-event"
              value={val}
              checked={event === val}
              onChange={() => setEvent(val)}
            />
            {label}
          </label>
        ))}
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
