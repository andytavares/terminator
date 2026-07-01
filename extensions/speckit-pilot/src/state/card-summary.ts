import { PHASE_ORDER } from '../types/speckit.types.js'
import type { CardBrief, CardRunStatus, CardSummary, PilotState } from '../types/speckit.types.js'

/** Map run + phase state onto a single board-facing run status. */
export function computeRunStatus(state: PilotState): CardRunStatus {
  const run = state.run
  if (!run || run.status === 'cancelled') return 'none'
  if (state.queuePosition === 'pending') return 'waiting'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'completed') return 'completed'
  const awaiting = Object.values(state.phases).some((p) => p.status === 'awaiting_review')
  return awaiting ? 'awaiting_review' : 'running'
}

function scopeLine(scope: string): string {
  const firstLine = scope.split('\n').find((l) => l.trim().length > 0) ?? ''
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine
}

/**
 * Build a board card summary from a pilot state. The card brief (from card.json)
 * takes precedence over the brief synthesized onto the state.
 */
export function buildCardSummary(state: PilotState, card: CardBrief | null): CardSummary {
  const brief = card ?? state.card
  const done = Object.values(state.phases).filter(
    (p) => p.status === 'approved' || p.status === 'skipped'
  ).length
  const awaitingReview = Object.values(state.phases).some((p) => p.status === 'awaiting_review')
  return {
    featureDir: state.featureDir,
    title: brief.title,
    type: brief.type,
    scopeLine: scopeLine(brief.scope),
    source: brief.source,
    sourceUrl: state.ticket?.sourceUrl ?? null,
    sourceKey: state.ticket?.key ?? null,
    stage: state.stage,
    runStatus: computeRunStatus(state),
    phaseSummary: { done, total: PHASE_ORDER.length, awaitingReview },
    prUrl: state.prUrl,
  }
}
