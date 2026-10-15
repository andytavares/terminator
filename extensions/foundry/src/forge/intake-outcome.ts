import type { LedgerEntry } from '../ledger/append.js'
import type { LoopFacts, AgreedFacts } from './readiness.js'

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
// What `readOnlyRound` writes for the red team: `${roleId}.refused`.
const REVIEW_REFUSED = 'red-team.refused'
const REVIEW_EXHAUSTED = 'review.exhausted'
const REVIEW_ANOTHER_PASS = 'review.another_pass'
const REVIEW_SKIPPED = 'review.skipped'

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
      /** Who is working. A red-team round and the scout are turns too. */
      readonly actor: 'architect' | 'red team' | 'scout'
      /** Whether the operator asked for this turn or the Forge started it on its own. */
      readonly trigger: 'you' | 'automatic'
      /** The red-team loop round this turn belongs to, when it is one. */
      readonly round: number | null
      /** Which automatic follow-up this is (1 or 2), when it is one. */
      readonly autoTurn: number | null
    }
  /** It finished and the order moved. */
  | { readonly kind: 'redrafted'; readonly at: string; readonly note: string }
  /** It finished and nothing moved, because the proposal was not accepted. */
  | { readonly kind: 'refused'; readonly at: string; readonly reason: string }

type Running = Extract<IntakeOutcome, { kind: 'running' }>

/** A turn that started with `entry` and has not ended, as `over` describes it. */
function runningFrom(
  entry: LedgerEntry,
  over: Pick<Running, 'asked' | 'actor' | 'trigger' | 'round' | 'autoTurn'>
): Running {
  return { kind: 'running', at: entry.at, sessionId: entry.subject, ...over }
}

/** The number a `round N…` reason names, or null when it names none. */
function roundIn(reason: string, pattern: RegExp): number | null {
  const match = pattern.exec(reason)
  return match === null ? null : Number(match[1])
}

/** Which automatic follow-up this is: the `converge.followed_up`s since the last start. */
function autoTurnAt(entries: readonly LedgerEntry[], i: number): number {
  let autoTurn = 0
  for (let j = i; j >= 0; j -= 1) {
    if (entries[j].action === FOLLOWED_UP) autoTurn += 1
    else if (entries[j].action === STARTED) break
  }
  return autoTurn
}

type IntakeReader = (
  entry: LedgerEntry,
  entries: readonly LedgerEntry[],
  i: number
) => IntakeOutcome

const readRefusal: IntakeReader = (entry) => ({
  kind: 'refused',
  at: entry.at,
  reason: entry.reason,
})
const redrafted: IntakeReader = (entry) => ({ kind: 'redrafted', at: entry.at, note: entry.reason })

/** What each ledger action says about the last intake turn. */
const INTAKE_READERS: Record<string, IntakeReader> = {
  [REFUSED]: readRefusal,
  [REDRAFTED]: redrafted,
  // A fix turn the review loop started names its own round in the reason it
  // records: `red team round 2 fix`. Every other start is the operator's,
  // whether typed just now or the very first draft.
  [STARTED]: (entry) => {
    const round = roundIn(entry.reason, /^red team round (\d+)/)
    const trigger = round === null ? 'you' : 'automatic'
    return runningFrom(entry, {
      asked: entry.reason,
      actor: 'architect',
      trigger,
      round,
      autoTurn: null,
    })
  },
  [FOLLOWED_UP]: (entry, entries, i) =>
    runningFrom(entry, {
      asked: entry.reason,
      actor: 'architect',
      trigger: 'automatic',
      round: null,
      autoTurn: autoTurnAt(entries, i),
    }),
  [REVIEW_REFUSED]: readRefusal,
  // The loop giving up is "needs you", not a refusal — nothing about the
  // proposal was rejected, and the findings it stopped on are surfaced
  // through `loopFacts(entries).exhausted` instead.
  [REVIEW_EXHAUSTED]: redrafted,
  [REVIEW_STARTED]: (entry) =>
    runningFrom(entry, {
      asked: `red team, ${entry.reason}`,
      actor: 'red team',
      trigger: 'automatic',
      round: roundIn(entry.reason, /^round (\d+)/),
      autoTurn: null,
    }),
  [SCOUT_STARTED]: (entry) =>
    runningFrom(entry, {
      asked: 'scout',
      actor: 'scout',
      trigger: 'automatic',
      round: null,
      autoTurn: null,
    }),
  // A round that finished is not a turn running — either a fix turn or the
  // next round follows it, or nothing does because the order was handed off.
  // Either way there is no session waiting on an answer right now.
  [REVIEW_ROUND]: redrafted,
}

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
    if (Object.hasOwn(INTAKE_READERS, entry.action)) {
      return INTAKE_READERS[entry.action](entry, entries, i)
    }
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

const REVIEW_HELD = 'review.held'
const REVIEW_RELEASED = 'review.released'
const ORDER_AGREED = 'order.agreed'
const ENVIRONMENT_WAIVED = 'environment.waived'

/** What the ledger has said about the review loop so far, read in order. */
interface LoopTally {
  readonly rounds: { round: number; startedAt: string; finishedAt: string | null }[]
  heldAt: string | null
  releasedAt: string | null
  lastOfStartedOrExhausted: 'started' | 'exhausted' | null
  skipped: string | undefined
}

/** The round still open, finished at `at`. */
function finishOpenRound(tally: LoopTally, at: string): void {
  const open = [...tally.rounds].reverse().find((round) => round.finishedAt === null)
  if (open !== undefined) open.finishedAt = at
}

/** What each ledger action does to the tally. */
const LOOP_STEPS: Record<string, (tally: LoopTally, entry: LedgerEntry) => void> = {
  [REVIEW_STARTED]: (tally, entry) => {
    const match = /^round (\d+)/.exec(entry.reason)
    tally.rounds.push({
      round: match === null ? 0 : Number(match[1]),
      startedAt: entry.at,
      finishedAt: null,
    })
    tally.lastOfStartedOrExhausted = 'started'
  },
  [REVIEW_ROUND]: (tally, entry) => finishOpenRound(tally, entry.at),
  [REVIEW_REFUSED]: (tally, entry) => finishOpenRound(tally, entry.at),
  [REVIEW_EXHAUSTED]: (tally, entry) => {
    finishOpenRound(tally, entry.at)
    tally.lastOfStartedOrExhausted = 'exhausted'
  },
  [REVIEW_SKIPPED]: (tally, entry) => {
    tally.skipped = entry.reason
  },
  [REDRAFTED]: (tally) => {
    tally.skipped = undefined
  },
  [REVIEW_HELD]: (tally, entry) => {
    tally.heldAt = entry.at
  },
  [REVIEW_RELEASED]: (tally, entry) => {
    tally.releasedAt = entry.at
  },
}

/**
 * Every red-team round on this order, and whether the operator has it held.
 *
 * Read straight off the ledger rather than paired with `lastIntake`: a round
 * is a span of time with its own start and end, and the Forge needs the whole
 * history to draw "round 2 of 3" while round 3 is still running.
 */
export function loopFacts(entries: readonly LedgerEntry[]): LoopFacts {
  const tally: LoopTally = {
    rounds: [],
    heldAt: null,
    releasedAt: null,
    lastOfStartedOrExhausted: null,
    skipped: undefined,
  }
  for (const entry of entries) {
    if (Object.hasOwn(LOOP_STEPS, entry.action)) LOOP_STEPS[entry.action](tally, entry)
  }
  const { heldAt, releasedAt, skipped } = tally
  return {
    rounds: tally.rounds,
    heldAt: heldAt !== null && (releasedAt === null || heldAt > releasedAt) ? heldAt : null,
    exhausted: tally.lastOfStartedOrExhausted === 'exhausted',
    ...(skipped === undefined ? {} : { skipped }),
  }
}

/** How the order was agreed, from the last `order.agreed` line. */
export function agreedFacts(entries: readonly LedgerEntry[]): AgreedFacts | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.action === ORDER_AGREED) {
      return { at: entry.at, by: entry.actor === 'rule:forge' ? 'automatic' : 'you' }
    }
  }
  return null
}

/** When the operator last chose to hand off without a proven base branch. */
export function environmentWaivedAt(entries: readonly LedgerEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].action === ENVIRONMENT_WAIVED) return entries[i].at
  }
  return null
}

/**
 * When the last intake line was written, for "the last turn ended at …".
 *
 * Null while a turn is running, or when intake has never run — neither has an
 * end to report yet.
 */
export function turnEndedAt(entries: readonly LedgerEntry[]): string | null {
  const outcome = lastIntake(entries)
  return outcome.kind === 'running' || outcome.kind === 'none' ? null : outcome.at
}

/** Whether a red-team round finished after the plan last changed. */
export function reviewedCurrentPlan(entries: readonly LedgerEntry[]): boolean {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].action === REVIEW_ROUND || entries[i].action === REVIEW_SKIPPED) return true
    if (entries[i].action === REDRAFTED) return false
  }
  return false
}

/** Whether the last finished red-team round asked to attack the fix too. */
export function anotherPassWanted(entries: readonly LedgerEntry[]): boolean {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].action === REVIEW_ANOTHER_PASS) return true
    if (entries[i].action === REVIEW_ROUND || entries[i].action === REVIEW_STARTED) return false
  }
  return false
}
