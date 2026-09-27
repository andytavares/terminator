import type { LedgerEntry } from '../ledger/append.js'

// How the last intake turn ended.
//
// An intake turn is the only thing in Foundry that can finish without leaving
// a mark on the order it was about. A redraft saves the document; a refusal
// writes one ledger line and stops — the architect's proposal failed
// validation, so by definition there is nothing to merge.
//
// Nothing read that line. Measured on WO-0909-6db: the proposal was refused on
// a closed-set violation at 19:33, and every surface went on saying Foundry
// was shaping the order. The Forge's spinner watched `provenance.decisions`,
// which a refusal does not grow, so it polled for ever; the order list read
// the standing of a draft, which has no idea intake ever ran. The operator's
// report was two sentences: no way to recover, and no indication anything had
// gone wrong.
//
// So the ledger is the record of the turn, and this is how the turn is read
// back out of it.

/**
 * The lines one intake turn can leave.
 *
 * A follow-up the Forge starts on its own, closing a gap the architect left
 * behind rather than waiting for the operator to ask again, is still a turn
 * running — every reader here treats it the same as an operator-started one.
 */
const STARTED = 'converge.started'
const FOLLOWED_UP = 'converge.followed_up'
const REFUSED = 'converge.refused'
const REDRAFTED = 'order.redrafted'

// The review loop's own lines (see `src/forge/review-loop.ts`). None of them
// widen the union above: a round in progress is a turn running, the same as
// an architect's; a round that finished with nothing after it is read as a
// redraft, because that is exactly what it is — the order changed and no new
// turn has started; and a loop that gave up is read as a refusal, because
// both mean the same thing to every surface here: nothing moved on its own
// and the operator has to look. Forge.tsx reads only the existing kinds, so
// this file is the only place that has to know the loop exists.
const REVIEW_STARTED = 'review.started'
const SCOUT_STARTED = 'scout.started'
const REVIEW_ROUND = 'review.round'
const REVIEW_REFUSED = 'review.refused'
const REVIEW_EXHAUSTED = 'review.exhausted'

export type IntakeOutcome =
  /** Intake has never run on this order. */
  | { readonly kind: 'none' }
  /** An architect is working now: a start with nothing after it. */
  | {
      readonly kind: 'running'
      readonly at: string
      readonly sessionId: string
      /** What the operator asked for, so the surface can say which ask this is. */
      readonly asked: string
    }
  /** It finished and the order moved. */
  | { readonly kind: 'redrafted'; readonly at: string; readonly note: string }
  /** It finished and nothing moved, because the proposal was not accepted. */
  | { readonly kind: 'refused'; readonly at: string; readonly reason: string }

/**
 * Read the last intake turn out of an order's ledger.
 *
 * Pure over the entries, and last-write-wins rather than paired up: a turn
 * that was started twice, or one whose start was lost to a crash, still has an
 * unambiguous latest outcome, and that is the only thing any surface asks for.
 */
export function lastIntake(entries: readonly LedgerEntry[]): IntakeOutcome {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.action === REFUSED) return { kind: 'refused', at: entry.at, reason: entry.reason }
    if (entry.action === REDRAFTED) return { kind: 'redrafted', at: entry.at, note: entry.reason }
    if (entry.action === STARTED || entry.action === FOLLOWED_UP) {
      return { kind: 'running', at: entry.at, sessionId: entry.subject, asked: entry.reason }
    }
    if (entry.action === REVIEW_REFUSED || entry.action === REVIEW_EXHAUSTED) {
      return { kind: 'refused', at: entry.at, reason: entry.reason }
    }
    if (entry.action === REVIEW_STARTED) {
      return {
        kind: 'running',
        at: entry.at,
        sessionId: entry.subject,
        asked: `red team, ${entry.reason}`,
      }
    }
    if (entry.action === SCOUT_STARTED) {
      return { kind: 'running', at: entry.at, sessionId: entry.subject, asked: 'scout' }
    }
    // A round that finished is not a turn running — either a fix turn or the
    // next round follows it, or nothing does because the order was handed
    // off. Either way there is no session waiting on an answer right now.
    if (entry.action === REVIEW_ROUND)
      return { kind: 'redrafted', at: entry.at, note: entry.reason }
  }
  return { kind: 'none' }
}

/**
 * Why the last turn was refused, or null.
 *
 * The one-line form, for the callers that only need to know whether the order
 * is sitting on a dead turn.
 */
export function intakeRefusal(entries: readonly LedgerEntry[]): string | null {
  const last = lastIntake(entries)
  return last.kind === 'refused' ? last.reason : null
}
