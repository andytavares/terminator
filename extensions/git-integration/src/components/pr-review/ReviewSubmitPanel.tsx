import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { githubAPI } from '../../api/github'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { DraftComment } from '../../schemas/pr-review.schema'
import { choose } from '../text'

interface Props {
  repoRoot: string
  prNumber: number
  headSHA: string
  isOwnPr?: boolean
  onClose: () => void
  onApproved?: () => void
}

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

const OUTCOMES = [
  ['APPROVE', 'Approve'],
  ['REQUEST_CHANGES', 'Request changes'],
  ['COMMENT', 'Comment'],
] as const

interface Submission {
  repoRoot: string
  prNumber: number
  event: ReviewEvent
  body: string
  drafts: DraftComment[]
}

/** Why the review cannot be sent, or null: every outcome but approval needs a body or a comment. */
function submissionProblem(sub: Submission): string | null {
  if (sub.event === 'APPROVE' || sub.body.trim() || sub.drafts.length > 0) return null
  return 'A comment body is required for this review type.'
}

async function sendReview(sub: Submission): Promise<void> {
  const result = await githubAPI.prReviewSubmit({
    repoRoot: sub.repoRoot,
    prNumber: sub.prNumber,
    event: sub.event,
    body: sub.body,
    comments: sub.drafts.map((d) => ({
      path: d.path,
      line: d.line,
      startLine: d.startLine,
      side: d.side,
      body: d.body,
    })),
  })
  if ('error' in result) throw new Error((result as { error: string }).error)
}

function useReviewSubmit(props: Props) {
  const drafts = usePrReviewStore((s) => s.drafts)
  const clearDrafts = usePrReviewStore((s) => s.clearDrafts)
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { repoRoot, prNumber, headSHA } = props

  const handleSubmit = async () => {
    const sub = { repoRoot, prNumber, event, body, drafts }
    const problem = submissionProblem(sub)
    if (problem) return setError(problem)
    setSubmitting(true)
    setError(null)
    try {
      await sendReview(sub)
      if (drafts.length > 0) clearDrafts({ repoRoot, prNumber, headSHA })
      if (event === 'APPROVE' && props.onApproved) return props.onApproved()
      setSubmitted(true)
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setSubmitting(false)
    }
  }
  return { event, setEvent, body, setBody, submitting, submitted, error, handleSubmit }
}

type SubmitState = ReturnType<typeof useReviewSubmit>

function optionClass(val: ReviewEvent, selected: boolean, blocked: boolean): string {
  const base = `review-submit-option review-submit-option--${val.toLowerCase().replace('_', '-')}`
  const sel = choose(selected, ' review-submit-option--selected', '')
  return base + sel + choose(blocked, ' review-submit-option--disabled', '')
}

function OutcomeOptions({ state, isOwnPr }: { state: SubmitState; isOwnPr?: boolean }) {
  return (
    <div className="review-submit-options" role="radiogroup" aria-label="Review outcome">
      {OUTCOMES.map(([val, label]) => {
        const blocked = Boolean(isOwnPr) && val !== 'COMMENT'
        return (
          <label key={val} className={optionClass(val, state.event === val, blocked)}>
            <input
              type="radio"
              name="review-event"
              value={val}
              checked={state.event === val}
              disabled={blocked}
              onChange={() => !blocked && state.setEvent(val)}
            />
            {label}
          </label>
        )
      })}
    </div>
  )
}

function SummaryBody({ state }: { state: SubmitState }) {
  return (
    <textarea
      className="review-submit-body"
      value={state.body}
      onChange={(e) => state.setBody(e.target.value)}
      placeholder="Leave a summary comment (optional)…"
      rows={5}
      disabled={state.submitting}
    />
  )
}

function SubmitActions({ state, onClose }: { state: SubmitState; onClose: () => void }) {
  return (
    <div className="review-submit-actions">
      <Button onClick={onClose} disabled={state.submitting}>
        Cancel
      </Button>
      <Button variant="primary" onClick={state.handleSubmit} disabled={state.submitting}>
        {choose(state.submitting, 'Submitting…', 'Submit review')}
      </Button>
    </div>
  )
}

export function ReviewSubmitPanel(props: Props) {
  const state = useReviewSubmit(props)
  if (state.submitted) {
    return (
      <div className="review-submit-success">
        <p>Review submitted successfully.</p>
        <Button onClick={props.onClose}>Close</Button>
      </div>
    )
  }
  return (
    <div className="review-submit-panel">
      <h2 className="review-submit-heading">Submit review</h2>
      {props.isOwnPr && (
        <p className="review-submit-own-pr-notice">
          You cannot approve or request changes on your own pull request.
        </p>
      )}
      <OutcomeOptions state={state} isOwnPr={props.isOwnPr} />
      <SummaryBody state={state} />
      {state.error && <p className="review-submit-error">{state.error}</p>}
      <SubmitActions state={state} onClose={props.onClose} />
    </div>
  )
}
