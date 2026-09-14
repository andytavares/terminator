import type { LedgerEntry } from '../ledger/append.js'

// How the last run attempt ended, read back out of the ledger.
//
// The run-side twin of `forge/intake-outcome.ts`, for the same reason: the
// only record of a run stopping on an error, or refusing to ship, is one
// ledger line, and `standingOf` had no way to see it. Measured on
// WO-0913-0bd — every node in the run graph `passed`, `order.json` still said
// `running`, and the ledger's tail read `run.complete` then `run.failed`
// ("Opening the pull request for terminator failed: "). The surface fell
// through to "Between steps. Nothing is running right now." — a dead end
// naming no move, one phase after the refusal ADR 046 fixed for intake.

const FAILED = 'run.failed'
const SHIP_REFUSED = 'ship.refused'
const STARTED = 'run.started'
const RESUMED = 'run.resumed'
const COMPLETE = 'run.complete'
const HALTED = 'run.halted'

/**
 * Why the run last stopped on an error or refused to ship, or null.
 *
 * Scans backwards to the newest of the lines that decide the answer. A
 * failure is always the last thing written for the attempt it belongs to —
 * `run.complete` is appended immediately before it, on WO-0913-0bd's tail —
 * so a backward scan reaches the failure first and reads it correctly;
 * `run.started`/`run.resumed`/`run.complete`/`run.halted` with nothing after
 * them means the latest attempt did not fail.
 */
export function runFailure(entries: readonly LedgerEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.action === FAILED || entry.action === SHIP_REFUSED) return entry.reason
    if (
      entry.action === STARTED ||
      entry.action === RESUMED ||
      entry.action === COMPLETE ||
      entry.action === HALTED
    ) {
      return null
    }
  }
  return null
}
