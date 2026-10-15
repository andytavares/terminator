import React, { useState } from 'react'
import { Button, RelativeTime } from '@terminator/extension-ui'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { reviewAgentAPI } from '../../api/review-agent'
import { RichContent } from './RichContent'
import { errorMessageOf } from '../text'
import './brief-card.css'
import type { IssueComment } from '../../schemas/pr-review.schema'
import './review-layout.css'

/** What a Summarize button summarizes: the PR's description, or its discussion. */
export type SummarySubject =
  | { kind: 'description'; body: string | null | undefined }
  | { kind: 'discussion'; comments: IssueComment[] }

/** The text the agent is given; each comment keeps its author: "**ana**: Ship it". */
function subjectText(subject: SummarySubject): string {
  if (subject.kind === 'description') return subject.body ?? ''
  return subject.comments.map((c) => `**${c.author}**: ${c.body}`).join('\n\n')
}

/** One tab's summary: whether it is running, what came back, or why nothing did. Its owner keeps
 *  it across tab switches; nothing stores it, so closing the overview drops it. */
export function useSummary(repoRoot: string, prNumber: number) {
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finishedAt, setFinishedAt] = useState<string | null>(null)
  const requestSummary = async (subject: SummarySubject) => {
    setBusy(true)
    setError(null)
    try {
      const text = subjectText(subject)
      const result = await reviewAgentAPI.summarize({
        repoRoot,
        prNumber,
        kind: subject.kind,
        text,
      })
      if ('error' in result) setError(result.error)
      else {
        setSummary(result.summary)
        setFinishedAt(new Date().toISOString())
      }
    } catch (e) {
      setError(errorMessageOf(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, summary, error, finishedAt, requestSummary }
}

export type Summary = ReturnType<typeof useSummary>

interface Props {
  subject: SummarySubject
  summary: Summary
}

/** Whether the Brief is showing a summary, so the description below it can be clamped. */
export function summaryShown(summary: Summary): boolean {
  return Boolean(summary.summary) && !summary.error
}

function BriefHeading({ meta, action }: { meta: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="brief-card__head">
      <h2 className="brief-card__title">
        <Sparkles className="brief-card__icon" aria-hidden="true" />
        Brief
      </h2>
      <span className="brief-card__meta">{meta}</span>
      {action}
    </div>
  )
}

function BriefIdle({ subject, summary }: Props) {
  return (
    <div className="brief-idle">
      <Sparkles className="brief-card__icon" aria-hidden="true" />
      <span className="brief-idle__text">Summarize the {subject.kind} with the review agent</span>
      <Button size="sm" onClick={() => summary.requestSummary(subject)}>
        Summarize
      </Button>
    </div>
  )
}

function BriefBusy({ subject }: { subject: SummarySubject }) {
  return (
    <div className="brief-card" aria-busy="true">
      <BriefHeading meta={`reading the ${subject.kind}…`} />
      <div className="brief-skeleton">
        <span className="pr-visually-hidden">Summarizing</span>
        <i style={{ width: '92%' }} />
        <i style={{ width: '78%' }} />
        <i style={{ width: '86%' }} />
      </div>
    </div>
  )
}

function BriefDone({ subject, summary }: Props) {
  const regenerate = (
    <Button variant="ghost" size="sm" onClick={() => summary.requestSummary(subject)}>
      Regenerate
    </Button>
  )
  const meta = (
    <>
      review agent · from the {subject.kind} ·{' '}
      {summary.finishedAt && <RelativeTime value={summary.finishedAt} />}
    </>
  )
  return (
    <div className="brief-card">
      <BriefHeading meta={meta} action={regenerate} />
      <div className="brief-card__body">
        <RichContent>{summary.summary ?? ''}</RichContent>
      </div>
    </div>
  )
}

function BriefError({ subject, summary }: Props) {
  const reason = (summary.error ?? '').replace(/\.$/, '')
  return (
    <div className="brief-error" role="alert">
      <TriangleAlert className="brief-error__icon" aria-hidden="true" />
      <div>
        <p>The review agent could not summarize this: {reason}.</p>
        <Button size="sm" onClick={() => summary.requestSummary(subject)}>
          Try again
        </Button>
      </div>
    </div>
  )
}

/** The Brief: the review agent's summary of the description or discussion, in the state it is in. */
export function OverviewSummary({ subject, summary }: Props) {
  if (!subjectText(subject).trim()) return null
  if (summary.busy) return <BriefBusy subject={subject} />
  if (summary.error) return <BriefError subject={subject} summary={summary} />
  if (summary.summary) return <BriefDone subject={subject} summary={summary} />
  return <BriefIdle subject={subject} summary={summary} />
}
