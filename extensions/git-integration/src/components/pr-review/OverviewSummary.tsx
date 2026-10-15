import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { Sparkles } from 'lucide-react'
import { reviewAgentAPI } from '../../api/review-agent'
import { RichContent } from './RichContent'
import { choose, errorMessageOf } from '../text'
import type { IssueComment } from '../../schemas/pr-review.schema'

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
      else setSummary(result.summary)
    } catch (e) {
      setError(errorMessageOf(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, summary, error, requestSummary }
}

export type Summary = ReturnType<typeof useSummary>

interface Props {
  subject: SummarySubject
  summary: Summary
}

function SummaryError({ subject, summary }: Props) {
  return (
    <div className="pr-overview-summary-error" role="alert">
      <span>Could not summarize: {summary.error}</span>
      <Button size="sm" onClick={() => summary.requestSummary(subject)} disabled={summary.busy}>
        Retry
      </Button>
    </div>
  )
}

/** Summarize, and what the review agent's read-only claude said, above the text it summarized. */
export function OverviewSummary({ subject, summary }: Props) {
  if (!subjectText(subject).trim()) return null
  const idleLabel = choose(summary.summary, 'Summarize again', 'Summarize')
  return (
    <div className="pr-overview-summary">
      {!summary.error && (
        <Button
          size="sm"
          icon={Sparkles}
          onClick={() => summary.requestSummary(subject)}
          disabled={summary.busy}
          className="pr-overview-summary-button"
        >
          {choose(summary.busy, 'Summarizing…', idleLabel)}
        </Button>
      )}
      {summary.error && <SummaryError subject={subject} summary={summary} />}
      {summary.summary && !summary.error && (
        <div className="pr-overview-summary-text">
          <RichContent>{summary.summary}</RichContent>
        </div>
      )}
    </div>
  )
}
