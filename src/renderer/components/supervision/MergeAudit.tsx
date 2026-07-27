import React from 'react'
import { Check, X } from 'lucide-react'
import type {
  UnattendedMergeRecord,
  Hunk,
  HunkDecision,
} from '../../../shared/supervision/view-types.js'
import './supervision.css'

// Two surfaces that only exist because the operator is not watching: what
// merged without them (FR-061), and the per-hunk decisions that let them keep
// part of a change (FR-052).

export interface MergeAuditProps {
  merges: readonly UnattendedMergeRecord[]
}

export function MergeAudit({ merges }: MergeAuditProps): JSX.Element {
  if (merges.length === 0) {
    return <div className="sv-allclear">Nothing has merged unattended.</div>
  }

  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>{merges.length} merged while you were away</span>
      </div>
      {merges.map((merge) => (
        <div className="sv-row" key={`${merge.sessionId}-${merge.mergedAt}`}>
          <span className="sv-row__main">
            <div className="sv-queue__title">{merge.repoPath.split('/').pop()}</div>
            {/* Everything needed to review it after the fact, recorded at merge
                time so retrieval never depended on the operator acting first. */}
            <div className="sv-row__trigger">{merge.gradeTrigger}</div>
            <div className="sv-queue__meta">
              {merge.diffSummary.files} files · +{merge.diffSummary.added} −
              {merge.diffSummary.removed} · checks {merge.checkState} ·{' '}
              {new Date(merge.mergedAt).toLocaleString()}
            </div>
          </span>
        </div>
      ))}
    </div>
  )
}

export interface HunkReviewProps {
  hunks: readonly Hunk[]
  decisionFor(hunkId: string): HunkDecision | null
  onDecide(hunkId: string, decision: HunkDecision): void
}

export function HunkReview({ hunks, decisionFor, onDecide }: HunkReviewProps): JSX.Element {
  if (hunks.length === 0) {
    return <div className="sv-allclear">This change has no hunks to review.</div>
  }

  return (
    <div className="sv-panel">
      {hunks.map((hunk) => {
        const decision = decisionFor(hunk.id)
        return (
          <div className="sv-row" key={hunk.id}>
            <span className="sv-row__main">
              <div className="sv-queue__meta">
                {hunk.file}:{hunk.newStart}
              </div>
              <pre className="sv-queue__title">{hunk.lines.join('\n')}</pre>
            </span>
            {/* The unit of decision is the hunk, not the file: one file
                routinely holds both the change you asked for and the one you
                did not. */}
            <span className="sv-queue__actions">
              <button
                className={`sv-queue__btn${decision === 'accept' ? ' sv-chip--on' : ''}`}
                aria-pressed={decision === 'accept'}
                onClick={() => onDecide(hunk.id, 'accept')}
              >
                <Check aria-hidden="true" /> Keep
              </button>
              <button
                className={`sv-queue__btn${decision === 'reject' ? ' sv-chip--on' : ''}`}
                aria-pressed={decision === 'reject'}
                onClick={() => onDecide(hunk.id, 'reject')}
              >
                <X aria-hidden="true" /> Drop
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}
