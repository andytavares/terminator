import { describe, it, expect } from 'vitest'
import { strikeAssumption, affectedBy, liveAssumptions } from '../../src/forge/assumptions.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// An assumption the operator cannot see is a guess. Striking one has to redraw
// exactly what depended on it and nothing else — a strike that redrew the whole
// order would make correcting one detail cost the operator everything they had
// already settled.

function order(): WorkOrder {
  const base = draftOrder({
    id: 'WO-0101-aaa',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
      {
        id: 'AC-2',
        statement: 'b',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'one',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: [],
          verify: [],
        },
        {
          id: 'U-2',
          title: 'two',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-2'],
          touches: [],
          verify: [],
        },
      ],
    },
    assumptions: [
      { id: 'A-1', text: 'the fix belongs in TerminalPane.tsx', struck: false, affects: ['U-1'] },
      { id: 'A-2', text: 'single repository', struck: false, affects: ['U-1', 'U-2'] },
      { id: 'A-3', text: 'xterm 5.x, unchanged', struck: false, affects: [] },
    ],
  }
}

describe('strikeAssumption', () => {
  it('marks the assumption struck', () => {
    const after = strikeAssumption(order(), 'A-1')
    expect(after.order.assumptions.find((a) => a.id === 'A-1')?.struck).toBe(true)
  })

  it('reports exactly what has to be redrawn, and nothing more', () => {
    const after = strikeAssumption(order(), 'A-1')
    expect(after.redraw).toEqual(['U-1'])
  })

  it('redraws both units when the assumption held both up', () => {
    const after = strikeAssumption(order(), 'A-2')
    expect(after.redraw).toEqual(['U-1', 'U-2'])
  })

  it('redraws nothing when the assumption held nothing up', () => {
    const after = strikeAssumption(order(), 'A-3')
    expect(after.redraw).toEqual([])
  })

  it('returns an order to draft, because the plan is about to change', () => {
    const agreed: WorkOrder = { ...order(), status: 'agreed', agreedAt: '2026-09-06T11:00:00.000Z' }
    const after = strikeAssumption(agreed, 'A-1')
    expect(after.order.status).toBe('draft')
    expect(after.order.agreedAt).toBeNull()
  })

  it('does not mutate the order it was given', () => {
    const before = order()
    strikeAssumption(before, 'A-1')
    expect(before.assumptions[0].struck).toBe(false)
  })

  it('is idempotent — striking twice changes nothing the second time', () => {
    const once = strikeAssumption(order(), 'A-1')
    const twice = strikeAssumption(once.order, 'A-1')
    expect(twice.order.assumptions).toEqual(once.order.assumptions)
    expect(twice.redraw).toEqual([])
  })

  it('ignores an assumption that does not exist rather than throwing', () => {
    const after = strikeAssumption(order(), 'A-9')
    expect(after.redraw).toEqual([])
    expect(after.order.assumptions).toHaveLength(3)
  })
})

describe('affectedBy', () => {
  it('resolves the units and criteria an assumption held up', () => {
    expect(affectedBy(order(), 'A-2')).toEqual(['U-1', 'U-2'])
  })

  it('returns nothing for an unknown assumption', () => {
    expect(affectedBy(order(), 'A-9')).toEqual([])
  })
})

describe('liveAssumptions', () => {
  it('is what the operator still has to scan', () => {
    const after = strikeAssumption(order(), 'A-1')
    expect(liveAssumptions(after.order).map((a) => a.id)).toEqual(['A-2', 'A-3'])
  })
})
