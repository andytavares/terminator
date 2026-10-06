import { describe, it, expect } from 'vitest'
import { readiness } from '../../src/forge/readiness.js'
import type { LoopFacts, ReadinessInput } from '../../src/forge/readiness.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'
import type { WorkOrder } from '../../src/order/schema.js'

// A red team skipped for a small order (ADR 084) reads as passed, with the
// reason — not as "Not reviewed yet", which is a step still owed.

const REASON = 'graded P3, one lane, no risk triggers'
const T0 = '2026-09-28T13:00:00.000Z'

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Hide done tickets',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: T0,
  })
  return {
    ...base,
    intent: { problem: 'Done tickets show.', outcome: 'Done tickets are hidden.', nonGoals: [] },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'Done tickets are excluded',
        priority: 'P1',
        verify: { kind: 'test', command: 'npx vitest run a.spec.ts', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    risk: { grade: 'P3', triggers: [], blastRadius: ['a.ts'], criticalPaths: [] },
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'Filter',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['a.ts'],
          verify: [],
        },
      ],
    },
    ...over,
  }
}

function input(loop: Partial<LoopFacts>, o: WorkOrder = order()): ReadinessInput {
  return {
    order: o,
    compile: compileOrder(o),
    intake: { kind: 'none' },
    loop: { rounds: [], heldAt: null, exhausted: false, ...loop },
    agreed: null,
    turnEndedAt: null,
    shape: { name: 'Direct', yours: false },
    offers: { shape: true, tracker: true },
    clock: (iso) => iso,
  }
}

describe('readiness — a skipped red team', () => {
  it('reads the step as done with the reason', () => {
    const step = readiness(input({ skipped: REASON })).steps.find((s) => s.id === 'redTeam')
    expect(step).toMatchObject({ state: 'done', mark: 'check', word: `Skipped: ${REASON}` })
  })

  it('reads the row as passed with the reason', () => {
    const row = readiness(input({ skipped: REASON })).rows.find((r) => r.id === 'redTeam')
    expect(row?.state).toBe('passed')
    expect(row?.detail).toContain(REASON)
  })

  it('still reads not reviewed when nothing was skipped or run', () => {
    const step = readiness(input({})).steps.find((s) => s.id === 'redTeam')
    expect(step).toMatchObject({ state: 'not-yet', word: 'Not reviewed yet' })
  })
})
