import { describe, it, expect } from 'vitest'
import {
  lastIntake,
  intakeRefusal,
  loopFacts,
  agreedFacts,
  turnEndedAt,
  reviewedCurrentPlan,
  anotherPassWanted,
} from '../../src/forge/intake-outcome.js'
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
      actor: 'architect',
      trigger: 'you',
      round: null,
      autoTurn: null,
    })
  })

  it('is running, as the loop’s own fix turn, when the operator did not start it', () => {
    const out = lastIntake([
      entry({
        action: 'converge.started',
        subject: 'sess-9',
        reason: 'red team round 2 fix',
      }),
    ])
    expect(out).toEqual({
      kind: 'running',
      at: '2026-09-09T19:30:00Z',
      sessionId: 'sess-9',
      asked: 'red team round 2 fix',
      actor: 'architect',
      trigger: 'automatic',
      round: 2,
      autoTurn: null,
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
      actor: 'architect',
      trigger: 'automatic',
      round: null,
      autoTurn: 1,
    })
  })

  it('counts which automatic follow-up this is, since the most recent start', () => {
    const out = lastIntake([
      entry({ action: 'converge.started', at: '2026-09-09T19:30:00Z', subject: 'sess-2' }),
      entry({
        action: 'converge.followed_up',
        at: '2026-09-09T19:31:00Z',
        subject: 'sess-2a',
      }),
      entry({
        action: 'converge.followed_up',
        at: '2026-09-09T19:32:00Z',
        subject: 'sess-2b',
      }),
    ])
    expect(out).toMatchObject({ kind: 'running', autoTurn: 2 })
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
      actor: 'architect',
      trigger: 'you',
      round: null,
      autoTurn: null,
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
      actor: 'red team',
      trigger: 'automatic',
      round: 2,
      autoTurn: null,
    })
  })

  it('is running while the scout is the last thing that happened', () => {
    const out = lastIntake([entry({ action: 'scout.started', subject: 'sess-4' })])
    expect(out).toEqual({
      kind: 'running',
      at: '2026-09-09T19:30:00Z',
      sessionId: 'sess-4',
      asked: 'scout',
      actor: 'scout',
      trigger: 'automatic',
      round: null,
      autoTurn: null,
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

  // The loop giving up is "needs you", not a refusal: nothing about the
  // proposal was rejected. `loopFacts(entries).exhausted` is what surfaces it.
  it('is redrafted, not refused, when the loop could not converge', () => {
    const out = lastIntake([
      entry({
        action: 'review.exhausted',
        at: '2026-09-09T19:40:00Z',
        reason: 'still has 1 blocking finding after 3 rounds',
      }),
    ])
    expect(out).toEqual({
      kind: 'redrafted',
      at: '2026-09-09T19:40:00Z',
      note: 'still has 1 blocking finding after 3 rounds',
    })
  })

  // `readOnlyRound` writes `${roleId}.refused`, so a red-team round that
  // could not run leaves `red-team.refused`. Read as anything else, the round
  // it closes stays `running` and the Forge says the red team is working for
  // ever.
  it('is refused when a red-team round was refused', () => {
    const out = lastIntake([
      entry({ action: 'review.started', subject: 'rt-session', reason: 'round 1' }),
      entry({
        action: 'red-team.refused',
        actor: 'role:red-team',
        at: '2026-09-09T19:41:00Z',
        reason: 'no output written',
      }),
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

describe('loopFacts', () => {
  it('is empty, unheld, not exhausted with no review lines', () => {
    expect(loopFacts([])).toEqual({ rounds: [], heldAt: null, exhausted: false })
  })

  it('pairs a started round with the round summary that finishes it', () => {
    const out = loopFacts([
      entry({ action: 'review.started', at: '2026-09-09T19:30:00Z', reason: 'round 1' }),
      entry({
        action: 'review.round',
        at: '2026-09-09T19:35:00Z',
        reason: 'round 1: 1 blocking, 0 notes',
      }),
    ])
    expect(out.rounds).toEqual([
      { round: 1, startedAt: '2026-09-09T19:30:00Z', finishedAt: '2026-09-09T19:35:00Z' },
    ])
  })

  it('leaves the current round unfinished while it is still going', () => {
    const out = loopFacts([
      entry({ action: 'review.started', at: '2026-09-09T19:30:00Z', reason: 'round 1' }),
      entry({ action: 'review.round', at: '2026-09-09T19:35:00Z', reason: 'round 1: 0, 0' }),
      entry({ action: 'review.started', at: '2026-09-09T19:40:00Z', reason: 'round 2' }),
    ])
    expect(out.rounds).toEqual([
      { round: 1, startedAt: '2026-09-09T19:30:00Z', finishedAt: '2026-09-09T19:35:00Z' },
      { round: 2, startedAt: '2026-09-09T19:40:00Z', finishedAt: null },
    ])
  })

  it('is held when the last hold is after the last release', () => {
    const out = loopFacts([
      entry({ action: 'review.held', at: '2026-09-09T19:30:00Z' }),
      entry({ action: 'review.released', at: '2026-09-09T19:31:00Z' }),
      entry({ action: 'review.held', at: '2026-09-09T19:32:00Z' }),
    ])
    expect(out.heldAt).toBe('2026-09-09T19:32:00Z')
  })

  it('is not held when the last release is after the last hold', () => {
    const out = loopFacts([
      entry({ action: 'review.held', at: '2026-09-09T19:30:00Z' }),
      entry({ action: 'review.released', at: '2026-09-09T19:31:00Z' }),
    ])
    expect(out.heldAt).toBeNull()
  })

  it('is exhausted when the loop gave up last', () => {
    const out = loopFacts([
      entry({ action: 'review.started', reason: 'round 1' }),
      entry({ action: 'review.exhausted', reason: 'still has 1 blocking finding' }),
    ])
    expect(out.exhausted).toBe(true)
  })

  it('is not exhausted once a fresh round has started since', () => {
    const out = loopFacts([
      entry({ action: 'review.exhausted', reason: 'gave up' }),
      entry({ action: 'review.started', reason: 'round 1' }),
    ])
    expect(out.exhausted).toBe(false)
  })
})

describe('agreedFacts', () => {
  it('is null before the order is agreed', () => {
    expect(agreedFacts([])).toBeNull()
  })

  it('is by you when the operator agreed it', () => {
    const out = agreedFacts([
      entry({ action: 'order.agreed', at: '2026-09-09T19:45:00Z', actor: 'operator' }),
    ])
    expect(out).toEqual({ at: '2026-09-09T19:45:00Z', by: 'you' })
  })

  it('is automatic when the rule agreed it', () => {
    const out = agreedFacts([
      entry({ action: 'order.agreed', at: '2026-09-09T19:45:00Z', actor: 'rule:forge' }),
    ])
    expect(out).toEqual({ at: '2026-09-09T19:45:00Z', by: 'automatic' })
  })
})

describe('turnEndedAt', () => {
  it('is null while a turn is running', () => {
    expect(turnEndedAt([entry({ action: 'converge.started' })])).toBeNull()
  })

  it('is null when intake has never run', () => {
    expect(turnEndedAt([])).toBeNull()
  })

  it('is the time of the last intake line once it finished', () => {
    const at = turnEndedAt([
      entry({ action: 'order.redrafted', at: '2026-09-09T19:33:00Z', reason: 'added criteria' }),
    ])
    expect(at).toBe('2026-09-09T19:33:00Z')
  })
})

describe('reviewedCurrentPlan', () => {
  it('is false before any review', () => {
    expect(reviewedCurrentPlan([entry({ action: 'order.redrafted' })])).toBe(false)
  })

  it('is true when a round finished after the last redraft', () => {
    expect(
      reviewedCurrentPlan([entry({ action: 'order.redrafted' }), entry({ action: 'review.round' })])
    ).toBe(true)
  })

  it('is false once the plan was redrafted after the round', () => {
    expect(
      reviewedCurrentPlan([entry({ action: 'review.round' }), entry({ action: 'order.redrafted' })])
    ).toBe(false)
  })
})

describe('anotherPassWanted', () => {
  it('is false when the last round asked for nothing more', () => {
    expect(
      anotherPassWanted([
        entry({ action: 'review.round' }),
        entry({ action: 'converge.started', reason: 'red team round 1 fix' }),
        entry({ action: 'order.redrafted' }),
      ])
    ).toBe(false)
  })

  it('is true when the last round asked for another pass', () => {
    expect(
      anotherPassWanted([
        entry({ action: 'review.round' }),
        entry({ action: 'review.another_pass' }),
        entry({ action: 'converge.started', reason: 'red team round 1 fix' }),
        entry({ action: 'order.redrafted' }),
      ])
    ).toBe(true)
  })

  it('belongs to the round that asked, not the one after it', () => {
    expect(
      anotherPassWanted([
        entry({ action: 'review.round' }),
        entry({ action: 'review.another_pass' }),
        entry({ action: 'review.started', reason: 'round 2' }),
        entry({ action: 'review.round' }),
      ])
    ).toBe(false)
  })
})

describe('a skipped red team', () => {
  it('is read off the ledger by loopFacts', () => {
    const facts = loopFacts([
      entry({ action: 'review.skipped', reason: 'graded P3, one lane, no risk triggers' }),
    ])
    expect(facts.skipped).toBe('graded P3, one lane, no risk triggers')
    expect(facts.rounds).toEqual([])
  })

  it('is forgotten when the plan is redrafted', () => {
    const facts = loopFacts([
      entry({ action: 'review.skipped', reason: 'small' }),
      entry({ action: 'order.redrafted' }),
    ])
    expect(facts.skipped).toBeUndefined()
  })

  it('counts as having reviewed the current plan, until a redraft', () => {
    const skipped = entry({ action: 'review.skipped', reason: 'small' })
    expect(reviewedCurrentPlan([skipped])).toBe(true)
    expect(reviewedCurrentPlan([skipped, entry({ action: 'order.redrafted' })])).toBe(false)
  })
})
