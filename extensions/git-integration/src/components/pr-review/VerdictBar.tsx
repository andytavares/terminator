import React, { useState } from 'react'
import { CircleCheck, CircleX, MessageSquare, type LucideIcon } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { plural } from '@terminator/extension-sdk'
import { recordUsage } from '@terminator/extension-sdk/renderer'
import { githubAPI } from '../../api/github'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { DraftComment } from '../../schemas/pr-review.schema'
import './verdict-bar.css'

interface Props {
  repoRoot: string
  prNumber: number
  headSHA: string
  isOwnPr?: boolean
  onApproved?: () => void
  /** The summary box, which Cmd+Enter and "Review drafts" move focus to. */
  summaryRef?: React.RefObject<HTMLTextAreaElement | null>
}

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

interface Verdict {
  event: ReviewEvent
  label: string
  icon: LucideIcon
}

const VERDICTS: Verdict[] = [
  { event: 'COMMENT', label: 'Comment', icon: MessageSquare },
  { event: 'REQUEST_CHANGES', label: 'Request changes', icon: CircleX },
  { event: 'APPROVE', label: 'Approve', icon: CircleCheck },
]

const OWN_PR_NOTE = 'You cannot approve or request changes on your own pull request.'

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

/** What the bar says under the buttons after a submit: the error, or that the review went. */
interface Notice {
  tone: 'error' | 'done'
  text: string
}

function useSubmitReview(props: Props) {
  const drafts = usePrReviewStore((s) => s.drafts)
  const clearDrafts = usePrReviewStore((s) => s.clearDrafts)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const { repoRoot, prNumber, headSHA } = props

  const submit = async (event: ReviewEvent) => {
    const sub = { repoRoot, prNumber, event, body, drafts }
    const problem = submissionProblem(sub)
    if (problem) return setNotice({ tone: 'error', text: problem })
    setSubmitting(true)
    setNotice(null)
    try {
      await sendReview(sub)
      recordUsage('review-comment')
      if (drafts.length > 0) clearDrafts({ repoRoot, prNumber, headSHA })
      if (event === 'APPROVE' && props.onApproved) return props.onApproved()
      setBody('')
      setNotice({ tone: 'done', text: 'Review submitted.' })
    } catch (e) {
      recordUsage('review-comment', { failed: true })
      setNotice({ tone: 'error', text: String(e).replace(/^Error:\s*/, '') })
    } finally {
      setSubmitting(false)
    }
  }
  return { drafts, body, setBody, submitting, notice, submit }
}

type SubmitState = ReturnType<typeof useSubmitReview>

/** Cmd+Enter (Ctrl+Enter off macOS) in the summary sends a comment review, when there is one. */
function summaryKeyDown(state: SubmitState) {
  return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return
    e.preventDefault()
    if (state.body.trim() || state.drafts.length > 0) void state.submit('COMMENT')
  }
}

function SummaryBox({
  state,
  summaryRef,
}: {
  state: SubmitState
  summaryRef?: Props['summaryRef']
}) {
  return (
    <textarea
      ref={summaryRef}
      className="vb-summary"
      aria-label="Review summary"
      value={state.body}
      onChange={(e) => state.setBody(e.target.value)}
      onKeyDown={summaryKeyDown(state)}
      placeholder="Leave a summary comment (optional)…"
      rows={1}
      disabled={state.submitting}
    />
  )
}

function VerdictButtons({ state, isOwnPr }: { state: SubmitState; isOwnPr?: boolean }) {
  return VERDICTS.map((verdict) => {
    const blocked = Boolean(isOwnPr) && verdict.event !== 'COMMENT'
    return (
      <Button
        key={verdict.event}
        variant={verdict.event === 'APPROVE' ? 'primary' : 'secondary'}
        icon={verdict.icon}
        title={blocked ? OWN_PR_NOTE : undefined}
        disabled={state.submitting || blocked}
        onClick={() => void state.submit(verdict.event)}
      >
        {verdict.label}
      </Button>
    )
  })
}

/** The review's verdict, always on screen under the diff: drafts, a summary and the three verdicts. */
export function VerdictBar(props: Props) {
  const state = useSubmitReview(props)
  const draftCount = state.drafts.length
  return (
    <section className="vb-bar" aria-label="Review verdict">
      <span className="vb-drafts">{`${draftCount} draft ${plural(draftCount, 'comment')}`}</span>
      <SummaryBox state={state} summaryRef={props.summaryRef} />
      <VerdictButtons state={state} isOwnPr={props.isOwnPr} />
      {state.notice && (
        <p
          className={`vb-notice vb-notice--${state.notice.tone}`}
          role={state.notice.tone === 'error' ? 'alert' : 'status'}
        >
          {state.notice.text}
        </p>
      )}
    </section>
  )
}
