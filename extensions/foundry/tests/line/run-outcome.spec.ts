import { describe, it, expect } from 'vitest'
import { runFailure, runDocumentReady } from '../../src/line/run-outcome.js'
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
  // An agreed order whose run refused to start never reached `running`, so
  // the refusal is the only record of why nothing is building.
  it('is the reason when the run refused to start', () => {
    const reason = runFailure([
      entry({ action: 'order.agreed', actor: 'rule:forge' }),
      entry({ action: 'run.refused', reason: 'Unknown skill "ci-fix".' }),
    ])
    expect(reason).toBe('Unknown skill "ci-fix".')
  })

  it('forgets a refusal once a later start succeeded', () => {
    expect(
      runFailure([
        entry({ action: 'run.refused', reason: 'no runtime' }),
        entry({ action: 'run.started', at: '2026-09-13T10:01:00Z' }),
      ])
    ).toBeNull()
  })

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

describe('runDocumentReady', () => {
  it('is the reason when the latest attempt ended on a document', () => {
    expect(
      runDocumentReady([
        entry({ action: 'run.started' }),
        entry({ action: 'run.complete' }),
        entry({ action: 'run.document_ready', reason: 'outputs: /o/answer.md' }),
      ])
    ).toBe('outputs: /o/answer.md')
  })

  it('is null for a run that did not end on one', () => {
    expect(
      runDocumentReady([entry({ action: 'run.started' }), entry({ action: 'run.complete' })])
    ).toBeNull()
    expect(runDocumentReady([])).toBeNull()
  })

  it('is null once a later attempt has started, because that attempt is not finished', () => {
    expect(
      runDocumentReady([
        entry({ action: 'run.document_ready', reason: 'outputs: /o/answer.md' }),
        entry({ action: 'run.resumed' }),
      ])
    ).toBeNull()
  })

  it('is not a failure, and a failure after it is', () => {
    const ready = [
      entry({ action: 'run.started' }),
      entry({ action: 'run.document_ready', reason: 'outputs: /o/a.md' }),
    ]
    expect(runFailure(ready)).toBeNull()
    expect(runFailure([...ready, entry({ action: 'run.failed', reason: 'boom' })])).toBe('boom')
  })

  it('does not let an earlier failure show through a later document', () => {
    expect(
      runFailure([
        entry({ action: 'run.failed', reason: 'old' }),
        entry({ action: 'run.document_ready', reason: 'outputs: a.md' }),
      ])
    ).toBeNull()
  })
})
