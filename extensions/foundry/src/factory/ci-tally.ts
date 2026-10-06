import type { Check } from '../line/ci.js'

// One count of where a pull's checks stand, shared by the tower's lamps, the
// pinned wait and the monitor, so they cannot disagree about what "done" is.
//
// A skipped check will never finish and is not a failure, so it counts with
// the passed; a cancelled one counts with the failed.

export interface CheckTally {
  readonly passed: number
  readonly pending: number
  readonly failed: number
  readonly total: number
  /** Everything no longer pending. */
  readonly done: number
}

export function tallyChecks(buckets: Iterable<Check['bucket']>): CheckTally {
  let passed = 0
  let pending = 0
  let failed = 0
  for (const bucket of buckets) {
    if (bucket === 'pending') pending++
    else if (bucket === 'fail' || bucket === 'cancel') failed++
    else passed++
  }
  const total = passed + pending + failed
  return { passed, pending, failed, total, done: total - pending }
}

/** What the tower says while it waits; null once nothing is pending. */
export function waitingOnChecks(tally: CheckTally): string | null {
  return tally.pending === 0 ? null : `Waiting on checks · ${tally.done} of ${tally.total} done`
}
