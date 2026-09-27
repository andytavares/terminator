import React from 'react'
import { ArrowRight } from 'lucide-react'
import { useReviewUiStore } from '../../stores/review-ui.store'
import type { PrReviewDetail, ReviewNote, DraftComment } from '../../schemas/pr-review.schema'
import type { AgentRun } from '../../schemas/review-agent.schema'

interface Props {
  pr: PrReviewDetail
  lastAccessedAt: string
  viewedCount: number
  totalFiles: number
  currentChapterId: string | null
  currentFilePath: string | null
  lastLine: number | null
  notes: ReviewNote[]
  drafts: DraftComment[]
  agentRuns: AgentRun[]
  changedSinceCount: number
  onContinue: () => void
}

const SEVERITY_RANK: Record<string, number> = { 'must-fix': 3, suggestion: 2, question: 1, nit: 0 }

/** "Yesterday 17:42" / "Today 09:10" / "3 d ago", for the resume card (S2). */
export function formatResumeTime(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const now = new Date()
  const time = then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const oneDay = 24 * 60 * 60 * 1000
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfThen) / oneDay)
  if (diffDays === 0) return `Today ${time}`
  if (diffDays === 1) return `Yesterday ${time}`
  return `${diffDays} d ago`
}

/**
 * S2: shown over the diff area when a stored session's lastAccessedAt is
 * more than 15 minutes old, so the reviewer sees where they left off before
 * anything else renders.
 */
export function ResumeCard({
  pr,
  lastAccessedAt,
  viewedCount,
  totalFiles,
  currentChapterId,
  currentFilePath,
  lastLine,
  notes,
  drafts,
  agentRuns,
  changedSinceCount,
  onContinue,
}: Props) {
  const openAgentPanel = useReviewUiStore((s) => s.openAgentPanel)

  const chapterIndex = pr.chapters.findIndex((c) => c.id === currentChapterId)
  const questionNote = notes.find((n) => n.body.includes('??'))
  const unopenedFindings = agentRuns
    .filter((r) => r.status === 'done')
    .flatMap((r) => r.findings)
    .filter((f) => !f.dismissed)
  const highestSeverity = unopenedFindings.reduce<string | null>((top, f) => {
    if (!top) return f.severity
    return SEVERITY_RANK[f.severity] > SEVERITY_RANK[top] ? f.severity : top
  }, null)

  const handleAskAgent = () => {
    if (!questionNote) return
    openAgentPanel(
      {
        kind: 'lines',
        path: questionNote.path,
        startLine: questionNote.line,
        endLine: questionNote.line,
        side: 'RIGHT',
        chapter: null,
      },
      'ask'
    )
  }

  return (
    <div className="rc-resume">
      <div className="rc-resume-head">
        <b>Where you left off · #{pr.number}</b>
        <span className="rc-note">
          {formatResumeTime(lastAccessedAt)} · {viewedCount} of {totalFiles} files viewed
        </span>
        <span className="rc-sp" style={{ flex: 1 }} />
        <button type="button" className="rc-btn rc-pri" onClick={onContinue}>
          Continue <span className="rc-kbd">↵</span>
        </button>
      </div>
      <ul>
        {currentFilePath && (
          <li>
            <span>
              <ArrowRight aria-hidden="true" />
            </span>
            <span>
              Chapter {chapterIndex + 1} · <code>{currentFilePath}</code>
              {lastLine != null ? ` line ${lastLine}` : ''}
            </span>
            <span className="rc-note">last position</span>
          </li>
        )}
        {notes.length > 0 && (
          <li>
            <span className="rc-pip">{notes.length}</span>
            <span>
              {notes.length} note{notes.length === 1 ? '' : 's'}
              {questionNote ? `, 1 is a question: "${questionNote.body}"` : ''}
            </span>
            {questionNote && (
              <button type="button" className="rc-btn rc-ag" onClick={handleAskAgent}>
                Ask agent
              </button>
            )}
          </li>
        )}
        {unopenedFindings.length > 0 && (
          <li>
            <span className="rc-pip rc-ag">{unopenedFindings.length}</span>
            <span>
              {unopenedFindings.length} agent finding{unopenedFindings.length === 1 ? '' : 's'} you
              haven&apos;t opened
            </span>
            <span className="rc-note">{highestSeverity}</span>
          </li>
        )}
        {drafts.length > 0 && (
          <li>
            <span className="rc-pip">{drafts.length}</span>
            <span>{drafts.length} draft comments not yet submitted</span>
            <button type="button" className="rc-btn">
              Review drafts
            </button>
          </li>
        )}
        {changedSinceCount > 0 && (
          <li>
            <span style={{ color: 'var(--tm-warning)' }}>●</span>
            <span>1 push since · {changedSinceCount} viewed files changed</span>
            <span className="rc-note">S1</span>
          </li>
        )}
      </ul>
    </div>
  )
}
