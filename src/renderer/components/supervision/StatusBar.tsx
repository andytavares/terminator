import React from 'react'
import { MessageCircleQuestion, Loader, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { formatElapsed } from './StateIndicator.js'
import type { StatusSummary } from '../../../shared/schemas/supervision.js'
import './supervision.css'

// Concept 10. The ambient case: visible on every surface so "is everything OK"
// never requires navigating anywhere (FR-025).

export interface StatusBarProps {
  summary: StatusSummary
  onOpenAttention?: () => void
}

export function StatusBar({ summary, onOpenAttention }: StatusBarProps): JSX.Element {
  const needsAttention = summary.needsInput > 0 || summary.failed > 0

  return (
    <button
      className="sv-statusbar"
      onClick={onOpenAttention}
      aria-label="Supervision status"
      title="Open the attention queue"
    >
      <span
        className={`sv-statusbar__group${
          summary.needsInput > 0 ? ' sv-statusbar__group--attention' : ''
        }`}
      >
        <MessageCircleQuestion aria-hidden="true" />
        {summary.needsInput} need you
      </span>

      <span className="sv-statusbar__group">
        <Loader aria-hidden="true" />
        {summary.working} working
      </span>

      <span className="sv-statusbar__group">
        <CheckCircle2 aria-hidden="true" />
        {summary.awaitingReview} to review
      </span>

      <span
        className={`sv-statusbar__group${
          summary.failed > 0 ? ' sv-statusbar__group--attention' : ''
        }`}
      >
        <XCircle aria-hidden="true" />
        {summary.failed} failed
      </span>

      {summary.oldestBlockedMs !== null && (
        <span className="sv-statusbar__group sv-statusbar__group--attention">
          <Clock aria-hidden="true" />
          oldest blocked {formatElapsed(summary.oldestBlockedMs)}
        </span>
      )}

      {!needsAttention && summary.oldestBlockedMs === null && (
        // Asserted, not implied by the absence of a badge.
        <span className="sv-statusbar__group">all clear</span>
      )}
    </button>
  )
}
