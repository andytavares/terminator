import React, { useId, useState } from 'react'
import { CircleCheck, CircleX, MessageSquare, type LucideIcon } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { githubAPI } from '../../api/github'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { DraftComment } from '../../schemas/pr-review.schema'
import { choose } from '../text'
import './review-submit.css'
import { recordUsage } from '@terminator/extension-sdk/renderer'

interface Props {
  repoRoot: string
  prNumber: number
  headSHA: string
  isOwnPr?: boolean
  onClose: () => void
  onApproved?: () => void
  /** Shown as a warning when files remain unviewed; omit to leave the warning out. */
  viewedCount?: number
  totalFiles?: number
}

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

interface Outcome {
  event: ReviewEvent
  label: string
  description: string
  submitLabel: string
  icon: LucideIcon
}

const OUTCOMES: Outcome[] = [
  {
    event: 'COMMENT',
    label: 'Comment',
    description: 'No verdict',
    submitLabel: 'Submit comment',
    icon: MessageSquare,
  },
  {
    event: 'APPROVE',
    label: 'Approve',
    description: 'Ready to merge',
    submitLabel: 'Submit approval',
    icon: CircleCheck,
  },
  {
    event: 'REQUEST_CHANGES',
    label: 'Request changes',
    description: 'Blocks merge',
    submitLabel: 'Submit changes request',
    icon: CircleX,
  },
]

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
      recordUsage('review-comment')
      if (drafts.length > 0) clearDrafts({ repoRoot, prNumber, headSHA })
      if (event === 'APPROVE' && props.onApproved) return props.onApproved()
      setSubmitted(true)
    } catch (e) {
      recordUsage('review-comment', { failed: true })
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setSubmitting(false)
    }
  }
  return { event, setEvent, body, setBody, submitting, submitted, error, handleSubmit }
}

type SubmitState = ReturnType<typeof useReviewSubmit>

function verdictClass(outcome: Outcome, selected: boolean, blocked: boolean): string {
  const base = `rs-verdict rs-verdict--${outcome.event.toLowerCase().replace('_', '-')}`
  return (
    base + choose(selected, ' rs-verdict--on', '') + choose(blocked, ' rs-verdict--blocked', '')
  )
}

function VerdictCard(props: {
  outcome: Outcome
  selected: boolean
  blocked: boolean
  onSelect: () => void
}) {
  const { outcome, selected, blocked } = props
  const titleId = useId()
  const descriptionId = useId()
  const Icon = outcome.icon
  return (
    <label className={verdictClass(outcome, selected, blocked)}>
      <input
        type="radio"
        name="review-event"
        value={outcome.event}
        checked={selected}
        disabled={blocked}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onChange={props.onSelect}
      />
      <b id={titleId}>
        <Icon aria-hidden="true" className="rs-verdict-icon" />
        {outcome.label}
      </b>
      <small id={descriptionId}>{outcome.description}</small>
    </label>
  )
}

function OutcomeOptions({ state, isOwnPr }: { state: SubmitState; isOwnPr?: boolean }) {
  return (
    <div className="rs-verdicts" role="radiogroup" aria-label="Review outcome">
      {OUTCOMES.map((outcome) => (
        <VerdictCard
          key={outcome.event}
          outcome={outcome}
          selected={state.event === outcome.event}
          blocked={Boolean(isOwnPr) && outcome.event !== 'COMMENT'}
          onSelect={() => state.setEvent(outcome.event)}
        />
      ))}
    </div>
  )
}

function firstLineOf(text: string): string {
  return text.split('\n')[0]
}

function PendingDrafts({ drafts }: { drafts: DraftComment[] }) {
  if (drafts.length === 0) return null
  return (
    <div className="rs-pending">
      <div className="rs-label">Pending · {drafts.length}</div>
      {drafts.map((draft) => (
        <div key={draft.id} className="rs-draft">
          <span className="rs-draft-ref">{`${draft.path}:${draft.line}`}</span>
          <p>{firstLineOf(draft.body)}</p>
        </div>
      ))}
    </div>
  )
}

function SummaryBody({ state }: { state: SubmitState }) {
  return (
    <textarea
      className="rs-summary"
      value={state.body}
      onChange={(e) => state.setBody(e.target.value)}
      placeholder="Leave a summary comment (optional)…"
      rows={5}
      disabled={state.submitting}
    />
  )
}

/** "You have viewed 4 of 23 files", or null when everything is viewed or the counts are unknown. */
function viewedWarning(viewedCount?: number, totalFiles?: number): string | null {
  if (viewedCount === undefined || totalFiles === undefined || viewedCount >= totalFiles)
    return null
  return `You have viewed ${viewedCount} of ${totalFiles} files`
}

function SubmitActions(props: { state: SubmitState; onClose: () => void; warning: string | null }) {
  const { state } = props
  const outcome = OUTCOMES.find((o) => o.event === state.event) ?? OUTCOMES[0]
  return (
    <div className="rs-actions">
      <span className="rs-hint">{props.warning}</span>
      <Button onClick={props.onClose} disabled={state.submitting}>
        Cancel
      </Button>
      <Button variant="primary" onClick={state.handleSubmit} disabled={state.submitting}>
        {choose(state.submitting, 'Submitting…', outcome.submitLabel)}
      </Button>
    </div>
  )
}

function SubmittedNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="rs-success">
      <p>Review submitted successfully.</p>
      <Button onClick={onClose}>Close</Button>
    </div>
  )
}

export function ReviewSubmitPanel(props: Props) {
  const state = useReviewSubmit(props)
  const drafts = usePrReviewStore((s) => s.drafts)
  if (state.submitted) return <SubmittedNotice onClose={props.onClose} />
  return (
    <div className="rs-panel">
      <h2 className="rs-heading">Submit review</h2>
      {props.isOwnPr && (
        <p className="rs-own-pr-notice">
          You cannot approve or request changes on your own pull request.
        </p>
      )}
      <PendingDrafts drafts={drafts} />
      <SummaryBody state={state} />
      <OutcomeOptions state={state} isOwnPr={props.isOwnPr} />
      {state.error && <p className="rs-error">{state.error}</p>}
      <SubmitActions
        state={state}
        onClose={props.onClose}
        warning={viewedWarning(props.viewedCount, props.totalFiles)}
      />
    </div>
  )
}
