import { describe, it, expect } from 'vitest'
import { lastIntake, intakeRefusal } from '../../src/forge/intake-outcome.js'
import type { LedgerEntry } from '../../src/ledger/append.js'

// How the last intake turn ended, read back out of the ledger.
//
// It has to be read from there because a refusal is written there and nowhere
// else: the proposal failed validation, so there is no redraft to save and the
// order document is byte-for-byte what it was.

function entry(over: Partial<LedgerEntry> & Pick<LedgerEntry, 'action'>): LedgerEntry {
  return {
    at: '2026-09-09T19:30:00Z',
    orderId: 'WO-1',
    actor: 'role:architect',
    subject: 'WO-1',
    reason: '',
    evidence: [],
    ...over,
  }
}

describe('lastIntake', () => {
  it('is none when intake has never run', () => {
    expect(lastIntake([]).kind).toBe('none')
    expect(lastIntake([entry({ action: 'order.agreed' })]).kind).toBe('none')
  })

  it('is running while a start is the last thing that happened', () => {
    const out = lastIntake([
      entry({ action: 'converge.started', subject: 'sess-1', reason: 'close the gap' }),
    ])
    expect(out).toEqual({
      kind: 'running',
      at: '2026-09-09T19:30:00Z',
      sessionId: 'sess-1',
      asked: 'close the gap',
    })
  })

  // A turn the Forge started on its own, closing a gap the architect left
  // behind, still counts as an operator-started turn to every reader here.
  it('is running while a follow-up the Forge started itself is the last thing that happened', () => {
    const out = lastIntake([
      entry({
        action: 'converge.followed_up',
        subject: 'sess-2',
        reason: 'closing the failing checks on its own',
      }),
    ])
    expect(out).toEqual({
      kind: 'running',
      at: '2026-09-09T19:30:00Z',
      sessionId: 'sess-2',
      asked: 'closing the failing checks on its own',
    })
  })

  it('is redrafted once the architect has saved one', () => {
    const out = lastIntake([
      entry({ action: 'converge.started', subject: 'sess-1' }),
      entry({
        action: 'order.redrafted',
        at: '2026-09-09T19:33:00Z',
        reason: 'added six criteria',
      }),
    ])
    expect(out).toEqual({
      kind: 'redrafted',
      at: '2026-09-09T19:33:00Z',
      note: 'added six criteria',
    })
  })

  // The case the whole module exists for.
  it('is refused, carrying the validator’s reason', () => {
    const out = lastIntake([
      entry({ action: 'converge.started', subject: 'sess-1' }),
      entry({
        action: 'converge.refused',
        at: '2026-09-09T19:33:21Z',
        reason: 'acceptance.5.verify.evidence.1: Invalid enum value.',
      }),
    ])
    expect(out).toEqual({
      kind: 'refused',
      at: '2026-09-09T19:33:21Z',
      reason: 'acceptance.5.verify.evidence.1: Invalid enum value.',
    })
  })

  // Entries the order accumulates between turns must not hide the turn.
  it('reads past everything that is not an intake line', () => {
    const out = lastIntake([
      entry({ action: 'converge.refused', reason: 'nope' }),
      entry({ action: 'question.answered', actor: 'operator' }),
      entry({ action: 'assumption.struck', actor: 'operator' }),
    ])
    expect(out.kind).toBe('refused')
  })

  // A turn started twice, or one whose start was lost to a crash, still has an
  // unambiguous latest outcome — which is the only thing any surface asks for.
  it('takes the last turn, not the first', () => {
    const out = lastIntake([
      entry({ action: 'converge.started', subject: 'sess-1' }),
      entry({ action: 'converge.refused', reason: 'first go' }),
      entry({ action: 'converge.started', at: '2026-09-09T19:40:00Z', subject: 'sess-2' }),
    ])
    expect(out).toEqual({
      kind: 'running',
      at: '2026-09-09T19:40:00Z',
      sessionId: 'sess-2',
      asked: '',
    })
  })
})

// The review loop's lines — see src/forge/review-loop.ts and
// docs/research/foundry-red-team-loop.md.
describe('lastIntake, for the review loop', () => {
  it('is running while a red-team round is the last thing that happened', () => {
    const out = lastIntake([
      entry({ action: 'review.started', subject: 'sess-3', reason: 'round 2' }),
    ])
    expect(out).toEqual({
      kind: 'running',
      at: '2026-09-09T19:30:00Z',
      sessionId: 'sess-3',
      asked: 'red team, round 2',
    })
  })

  it('is running while the scout is the last thing that happened', () => {
    const out = lastIntake([entry({ action: 'scout.started', subject: 'sess-4' })])
    expect(out).toEqual({
      kind: 'running',
      at: '2026-09-09T19:30:00Z',
      sessionId: 'sess-4',
      asked: 'scout',
    })
  })

  it('is not running once a round finished with nothing after it', () => {
    const out = lastIntake([
      entry({ action: 'review.started', subject: 'sess-3' }),
      entry({
        action: 'review.round',
        at: '2026-09-09T19:35:00Z',
        reason: 'round 2: 0 blocking, 1 note',
      }),
    ])
    expect(out).toEqual({
      kind: 'redrafted',
      at: '2026-09-09T19:35:00Z',
      note: 'round 2: 0 blocking, 1 note',
    })
  })

  it('is refused when the loop could not converge', () => {
    const out = lastIntake([
      entry({
        action: 'review.exhausted',
        at: '2026-09-09T19:40:00Z',
        reason: 'still has 1 blocking finding after 3 rounds',
      }),
    ])
    expect(out).toEqual({
      kind: 'refused',
      at: '2026-09-09T19:40:00Z',
      reason: 'still has 1 blocking finding after 3 rounds',
    })
  })

  it('is refused when a review round was refused', () => {
    const out = lastIntake([
      entry({ action: 'review.refused', at: '2026-09-09T19:41:00Z', reason: 'no output written' }),
    ])
    expect(out).toEqual({
      kind: 'refused',
      at: '2026-09-09T19:41:00Z',
      reason: 'no output written',
    })
  })
})

describe('intakeRefusal', () => {
  it('is the reason when the last turn was refused', () => {
    expect(intakeRefusal([entry({ action: 'converge.refused', reason: 'bad enum' })])).toBe(
      'bad enum'
    )
  })

  it('is null for every other outcome', () => {
    expect(intakeRefusal([])).toBeNull()
    expect(intakeRefusal([entry({ action: 'converge.started' })])).toBeNull()
    expect(intakeRefusal([entry({ action: 'order.redrafted' })])).toBeNull()
  })
})
