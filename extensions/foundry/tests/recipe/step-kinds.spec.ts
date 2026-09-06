import { describe, it, expect } from 'vitest'
import { selectOver, evaluateWhen, checkExpect } from '../../src/recipe/step-kinds.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The expression surface is deliberately tiny, and the tests are here to keep
// it that way: a path, an optional filter, a comparison. The moment it grows an
// `if`, a recipe has stopped being data.

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'a',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: [],
          verify: [],
        },
        {
          id: 'U-2',
          title: 'b',
          role: 'scribe',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: [],
          verify: [],
        },
      ],
    },
    ...over,
  }
}

describe('selectOver', () => {
  it('selects every unit', () => {
    expect(selectOver('plan.units', order()).map((u) => u.id)).toEqual(['U-1', 'U-2'])
  })

  it('filters by a field', () => {
    expect(selectOver('plan.units[role=builder]', order()).map((u) => u.id)).toEqual(['U-1'])
  })

  it('filters by a numeric field, compared as text so a recipe needs no quoting', () => {
    expect(selectOver('plan.units[lane=1]', order())).toHaveLength(2)
  })

  it('selects nothing for a filter nothing matches', () => {
    expect(selectOver('plan.units[role=inspector]', order())).toEqual([])
  })

  it('selects nothing for a path it does not understand, rather than everything', () => {
    expect(selectOver('everything', order())).toEqual([])
    expect(selectOver('plan.lanes', order())).toEqual([])
  })

  it('tolerates surrounding whitespace', () => {
    expect(selectOver('  plan.units  ', order())).toHaveLength(2)
  })
})

describe('evaluateWhen', () => {
  it('is true when there is no condition — a step with no `when` always runs', () => {
    expect(evaluateWhen(undefined, order())).toBe(true)
    expect(evaluateWhen('   ', order())).toBe(true)
  })

  it('tests a collection for emptiness', () => {
    expect(evaluateWhen('risk.triggers is empty', order())).toBe(true)
    expect(evaluateWhen('risk.triggers is not empty', order())).toBe(false)
  })

  it('sees a collection that has something in it', () => {
    const o = order()
    o.risk.triggers = ['secrets']
    expect(evaluateWhen('risk.triggers is not empty', o)).toBe(true)
    expect(evaluateWhen('risk.triggers is empty', o)).toBe(false)
  })

  it('compares a collection count', () => {
    expect(evaluateWhen('plan.units count > 1', order())).toBe(true)
    expect(evaluateWhen('plan.units count > 5', order())).toBe(false)
    expect(evaluateWhen('plan.units count == 2', order())).toBe(true)
    expect(evaluateWhen('plan.lanes count >= 1', order())).toBe(true)
  })

  it('reaches only the collections it names, and no further', () => {
    expect(evaluateWhen('budgets.agents count > 0', order())).toBe(false)
  })

  it('is false for an expression it cannot read — a step that runs because nobody could read its condition is the worse failure', () => {
    expect(evaluateWhen('risk.grade == P0 && something', order())).toBe(false)
    expect(evaluateWhen('if risk then run', order())).toBe(false)
  })
})

describe('checkExpect', () => {
  it('passes when there is nothing to expect', () => {
    expect(checkExpect(undefined, { exit_code: 0 })).toEqual([])
  })

  it('holds a reproduction to failing first, which is the point of the bugfix shape', () => {
    expect(checkExpect({ suite_exit_code: '!= 0' }, { suite_exit_code: 1 })).toEqual([])
    const wrong = checkExpect({ suite_exit_code: '!= 0' }, { suite_exit_code: 0 })
    expect(wrong).toHaveLength(1)
    expect(wrong[0].key).toBe('suite_exit_code')
  })

  it('compares numbers with every operator', () => {
    expect(checkExpect({ n: '>= 1' }, { n: 1 })).toEqual([])
    expect(checkExpect({ n: '<= 1' }, { n: 2 })).toHaveLength(1)
    expect(checkExpect({ n: '> 0' }, { n: 1 })).toEqual([])
    expect(checkExpect({ n: '< 0' }, { n: 1 })).toHaveLength(1)
    expect(checkExpect({ n: '== 3' }, { n: 3 })).toEqual([])
  })

  it('reads a numeric string as a number', () => {
    expect(checkExpect({ n: '>= 2' }, { n: '3' })).toEqual([])
  })

  it('fails a comparison against something that is not a number at all', () => {
    expect(checkExpect({ n: '>= 2' }, { n: 'many' })).toHaveLength(1)
  })

  it('compares a bare literal for equality, as text', () => {
    expect(checkExpect({ status: 'passed' }, { status: 'passed' })).toEqual([])
    expect(checkExpect({ status: 'passed' }, { status: 'failed' })).toHaveLength(1)
  })

  it('reports a key that is missing entirely', () => {
    const failures = checkExpect({ tests_added: '>= 1' }, {})
    expect(failures).toHaveLength(1)
    expect(failures[0].actual).toBeUndefined()
  })

  it('reports every failing expectation, not just the first', () => {
    expect(checkExpect({ a: '>= 1', b: '>= 1' }, { a: 0, b: 0 })).toHaveLength(2)
  })

  it('carries what was expected and what was seen, so the message can be specific', () => {
    const [failure] = checkExpect({ exit_code: '== 0' }, { exit_code: 2 })
    expect(failure.expected).toBe('== 0')
    expect(failure.actual).toBe(2)
  })
})
