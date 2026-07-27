import React from 'react'
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { formatElapsed } from './StateIndicator.js'
import type {
  ReviewItem,
  ReviewStep,
  IntentReview,
} from '../../../shared/supervision/view-types.js'
import './supervision.css'

// Concept 08. Ordered worst-first, never by arrival (FR-046), with the specific
// trigger for each grade shown rather than just the letter (FR-050).

const STEP_LABELS: Record<ReviewStep, string> = {
  intent: 'Intent',
  risk: 'Risk',
  structure: 'Structure',
  tests: 'Tests',
}

export const REVIEW_STEP_ORDER: ReviewStep[] = ['intent', 'risk', 'structure', 'tests']

export interface ReviewInboxProps {
  items: readonly ReviewItem[]
  now: number
  onOpen(sessionId: string): void
}

export function ReviewInbox({ items, now, onOpen }: ReviewInboxProps): JSX.Element {
  if (items.length === 0) {
    return <div className="sv-allclear">Nothing is waiting for review.</div>
  }

  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>{items.length} awaiting review</span>
        <span>worst first</span>
      </div>
      {items.map((item) => (
        <button className="sv-row" key={item.sessionId} onClick={() => onOpen(item.sessionId)}>
          <span className="sv-row__grade">{item.grade}</span>
          <span className="sv-row__main">
            <div className="sv-queue__title">{item.branch}</div>
            {/* The trigger, not just the grade: "P0" alone tells you nothing
                about what to look at first. */}
            <div className="sv-row__trigger">{item.gradeTrigger}</div>
          </span>
          <span className="sv-queue__meta">
            {item.diffSummary.files} files · +{item.diffSummary.added} −{item.diffSummary.removed} ·{' '}
            {formatElapsed(Math.max(0, now - item.queuedAt))}
          </span>
        </button>
      ))}
    </div>
  )
}

export interface ReviewFlowProps {
  step: ReviewStep
  intent: IntentReview | null
  onAdvance(): void
}

/**
 * The four-step flow, intent first (FR-051). Intent is the step every diff
 * viewer skips, and the one that catches work nobody asked for.
 */
export function ReviewFlow({ step, intent, onAdvance }: ReviewFlowProps): JSX.Element {
  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        {REVIEW_STEP_ORDER.map((candidate) => (
          <span
            key={candidate}
            className={`sv-chip${candidate === step ? ' sv-chip--on' : ''}`}
            aria-current={candidate === step ? 'step' : undefined}
          >
            {STEP_LABELS[candidate]}
          </span>
        ))}
      </div>

      {step === 'intent' && intent !== null && (
        <div className="sv-row">
          <span className="sv-row__main">
            <div className="sv-queue__meta">You asked for</div>
            <div className="sv-queue__title">{intent.request}</div>
            <div className="sv-queue__meta">The agent says it did</div>
            <div className="sv-queue__title">{intent.agentAccount}</div>

            {intent.unexpectedFiles.length > 0 && (
              <div className="sv-warn">
                <AlertTriangle aria-hidden="true" />
                Touched without being asked: {intent.unexpectedFiles.join(', ')}
              </div>
            )}
            {intent.untouchedFiles.length > 0 && (
              <div className="sv-warn">
                <ShieldAlert aria-hidden="true" />
                Expected but untouched: {intent.untouchedFiles.join(', ')}
              </div>
            )}
            {!intent.hasScopeConcern && (
              <div className="sv-state">
                <CheckCircle2 aria-hidden="true" /> Scope matches the request
              </div>
            )}
          </span>
        </div>
      )}

      <div className="sv-panel__header">
        <button className="sv-queue__btn" onClick={onAdvance}>
          Next
        </button>
      </div>
    </div>
  )
}
