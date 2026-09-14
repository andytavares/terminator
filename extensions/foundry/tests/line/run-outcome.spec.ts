import { describe, it, expect } from 'vitest'
import { runFailure } from '../../src/line/run-outcome.js'
import type { LedgerEntry } from '../../src/ledger/append.js'

// How the last run attempt ended, read back out of the ledger — the run-side
// twin of `forge/intake-outcome.ts`. Reproduced from WO-0913-0bd: the run
// graph's nodes were all `passed`, `order.json` still said `running`, and the
// ledger's tail was `run.complete` then `run.failed` — "Opening the pull
// request for terminator failed: ". `standingOf` never read the ledger for a
// running order, so the surface fell through to "Between steps. Nothing is
// running right now." over a run that had stopped for good.

function entry(over: Partial<LedgerEntry> & Pick<LedgerEntry, 'action'>): LedgerEntry {
  return {
    at: '2026-09-13T10:00:00Z',
    orderId: 'WO-1',
    actor: 'rule:line',
    subject: 'WO-1',
    reason: '',
    evidence: [],
    ...over,
  }
}

describe('runFailure', () => {
  // The exact WO-0913-0bd tail: a run that finished its graph and then failed
  // trying to ship it.
  it('is the reason when the run finished and then failed to ship', () => {
    const reason = runFailure([
      entry({ action: 'run.started', subject: 'direct' }),
      entry({ action: 'run.complete', at: '2026-09-13T10:05:00Z' }),
      entry({
        action: 'run.failed',
        at: '2026-09-13T10:05:01Z',
        reason: 'Opening the pull request for terminator failed: ',
      }),
    ])
    expect(reason).toBe('Opening the pull request for terminator failed: ')
  })

  it('is the reason when the ship was refused rather than errored', () => {
    const reason = runFailure([
      entry({ action: 'run.started', subject: 'direct' }),
      entry({ action: 'run.complete', at: '2026-09-13T10:05:00Z' }),
      entry({
        action: 'ship.refused',
        at: '2026-09-13T10:05:01Z',
        reason: 'no acceptance criteria were verified',
      }),
    ])
    expect(reason).toBe('no acceptance criteria were verified')
  })

  // A retry clears the old failure: `run.resumed` is recorded before the retry
  // starts, so a scan hitting it first reads null rather than the stale
  // reason from the attempt before.
  it('is null once the run has been resumed after a failure', () => {
    const reason = runFailure([
      entry({ action: 'run.started', subject: 'direct' }),
      entry({ action: 'run.failed', reason: 'no worktree could be prepared' }),
      entry({ action: 'run.resumed', at: '2026-09-13T10:10:00Z' }),
    ])
    expect(reason).toBeNull()
  })

  it('is null when nothing has failed', () => {
    expect(runFailure([])).toBeNull()
    expect(runFailure([entry({ action: 'run.started' })])).toBeNull()
    expect(runFailure([entry({ action: 'run.complete' })])).toBeNull()
    expect(runFailure([entry({ action: 'run.halted', reason: 'waiting on a gate' })])).toBeNull()
  })
})
