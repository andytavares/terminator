import { describe, it, expect } from 'vitest'
import {
  CONFIDENCE_BAR,
  MAX_AUTO_TURNS,
  decideConfidentQuestions,
  dismissConfidentFindings,
  followUpFor,
} from '../../src/forge/autonomy.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { CompileFailure } from '../../src/order/compile.js'

// The Forge stops the operator only for what the architect cannot settle
// (spec 062): a choice it is less than 90% sure of, or a high-severity finding.
// Everything else it decides, says it decided, and carries on.

const AT = '2026-09-26T12:00:00.000Z'

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-1',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: AT,
    }),
    ...over,
  }
}

function question(over: Record<string, unknown> = {}) {
  return {
    id: 'Q-1',
    text: 'Hide done tickets or grey them out?',
    why: '',
    options: ['Hide them', 'Grey them out'],
    recommended: 0,
    answer: null,
    rank: 1,
    confidence: null,
    ...over,
  }
}

describe('decideConfidentQuestions', () => {
  it('takes the recommended option when the architect is at least 90% sure', () => {
    const next = decideConfidentQuestions(
      order({ openQuestions: [question({ confidence: 0.92 })] })
    )
    expect(next.openQuestions[0].answer).toBe('Hide them')
  })

  it('says what it decided as an assumption the operator can strike', () => {
    const next = decideConfidentQuestions(
      order({ openQuestions: [question({ confidence: 0.95 })] })
    )
    expect(next.assumptions).toContainEqual(
      expect.objectContaining({
        id: 'A-Q-1',
        struck: false,
        text: 'Hide done tickets or grey them out? — decided: Hide them (95% confident)',
      })
    )
  })

  it('decides at exactly the bar', () => {
    const next = decideConfidentQuestions(
      order({ openQuestions: [question({ confidence: CONFIDENCE_BAR })] })
    )
    expect(next.openQuestions[0].answer).toBe('Hide them')
  })

  it('leaves a question below the bar for the operator', () => {
    const next = decideConfidentQuestions(
      order({ openQuestions: [question({ confidence: 0.89 })] })
    )
    expect(next.openQuestions[0].answer).toBeNull()
    expect(next.assumptions).toHaveLength(0)
  })

  it('leaves a question with no stated confidence, or no recommendation, for the operator', () => {
    const next = decideConfidentQuestions(
      order({
        openQuestions: [
          question({ id: 'Q-1', confidence: null }),
          question({ id: 'Q-2', confidence: 0.99, recommended: null }),
          question({ id: 'Q-3', confidence: 0.99, recommended: 7 }),
        ],
      })
    )
    expect(next.openQuestions.every((q) => q.answer === null)).toBe(true)
  })

  it('never overrides an answer the operator already gave', () => {
    const next = decideConfidentQuestions(
      order({ openQuestions: [question({ confidence: 0.99, answer: 'Grey them out' })] })
    )
    expect(next.openQuestions[0].answer).toBe('Grey them out')
    expect(next.assumptions).toHaveLength(0)
  })
})

describe('dismissConfidentFindings', () => {
  const findings = [
    {
      id: 'RT-no-non-goals',
      severity: 'low' as const,
      text: 't',
      status: 'open' as const,
      reason: '',
    },
    {
      id: 'RT-fully-serial-plan',
      severity: 'medium' as const,
      text: 't',
      status: 'open' as const,
      reason: '',
    },
    {
      id: 'RT-no-runnable-check',
      severity: 'high' as const,
      text: 't',
      status: 'open' as const,
      reason: '',
    },
  ]

  it('accepts a low or medium finding the architect is at least 90% sure does not apply', () => {
    const next = dismissConfidentFindings(order({ redTeam: findings }), [
      { id: 'RT-no-non-goals', reason: 'a one-line fix has no scope to exclude', confidence: 0.93 },
    ])
    expect(next.redTeam[0]).toMatchObject({
      status: 'accepted',
      reason: 'architect, 93% confident: a one-line fix has no scope to exclude',
    })
  })

  it('never dismisses a high-severity finding — that one is the operator’s', () => {
    const next = dismissConfidentFindings(order({ redTeam: findings }), [
      { id: 'RT-no-runnable-check', reason: 'r', confidence: 0.99 },
    ])
    expect(next.redTeam[2].status).toBe('open')
  })

  it('leaves one dismissed below the bar, or with no reason, open', () => {
    const next = dismissConfidentFindings(order({ redTeam: findings }), [
      { id: 'RT-no-non-goals', reason: 'r', confidence: 0.5 },
      { id: 'RT-fully-serial-plan', reason: '  ', confidence: 0.99 },
    ])
    expect(next.redTeam.slice(0, 2).every((f) => f.status === 'open')).toBe(true)
  })
})

describe('followUpFor', () => {
  const failure = (check: CompileFailure['check'], detail = 'd'): CompileFailure => ({
    check,
    detail,
    subjectIds: [],
  })

  it('sends the architect back with every check it can close', () => {
    const message = followUpFor([failure('coverage', 'Nothing builds “x”.'), failure('risk')], 0)
    expect(message).toContain('coverage — Nothing builds “x”.')
    expect(message).toContain('risk — d')
  })

  it('stops for the operator when only their questions are left', () => {
    expect(followUpFor([failure('questions')], 0)).toBeNull()
  })

  it('does not relay the questions check to the architect alongside the rest', () => {
    expect(followUpFor([failure('questions', 'Q'), failure('risk')], 0)).not.toContain('questions')
  })

  it('stops after the automatic turns run out, rather than looping', () => {
    expect(followUpFor([failure('coverage')], MAX_AUTO_TURNS)).toBeNull()
  })

  it('has nothing to send when the order compiles', () => {
    expect(followUpFor([], 0)).toBeNull()
  })
})
