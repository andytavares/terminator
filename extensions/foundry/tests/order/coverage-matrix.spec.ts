import { describe, it, expect } from 'vitest'
import { coverageMatrix } from '../../src/order/coverage-matrix.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// Coverage in both directions is the check that matters most.
//
// Every failure this project has paid for has the same shape: individually
// correct units, collectively incomplete work. A criterion nobody built, or a
// unit built for a criterion nobody asked for. Both are an intersection in a
// matrix, decided before a single agent starts — not a judgement anyone makes
// while reading a plan.

function order(criteria: string[], units: { id: string; satisfies: string[] }[]): WorkOrder {
  const base = draftOrder({
    id: 'WO-0101-aaa',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    acceptance: criteria.map((id) => ({
      id,
      statement: `${id} holds`,
      priority: 'P1' as const,
      verify: { kind: 'test' as const, command: 'npm test', assert: 'exit_code == 0' },
      unverifiable: null,
    })),
    plan: {
      ...base.plan,
      units: units.map((u) => ({
        id: u.id,
        title: u.id,
        role: 'builder',
        lane: 1,
        dependsOn: [],
        satisfies: u.satisfies,
        touches: [],
        verify: [],
      })),
    },
  }
}

describe('coverageMatrix', () => {
  it('reports a complete order as covered in both directions', () => {
    const m = coverageMatrix(order(['AC-1', 'AC-2'], [{ id: 'U-1', satisfies: ['AC-1', 'AC-2'] }]))
    expect(m.uncoveredCriteria).toEqual([])
    expect(m.orphanUnits).toEqual([])
    expect(m.danglingRefs).toEqual([])
    expect(m.complete).toBe(true)
  })

  it('names a criterion no unit satisfies — an unbuilt requirement', () => {
    const m = coverageMatrix(
      order(['AC-1', 'AC-2', 'AC-3'], [{ id: 'U-1', satisfies: ['AC-1', 'AC-2'] }])
    )
    expect(m.uncoveredCriteria).toEqual(['AC-3'])
    expect(m.complete).toBe(false)
  })

  it('names a unit that satisfies nothing — scope nobody asked for', () => {
    const m = coverageMatrix(
      order(
        ['AC-1'],
        [
          { id: 'U-1', satisfies: ['AC-1'] },
          { id: 'U-2', satisfies: [] },
        ]
      )
    )
    expect(m.orphanUnits).toEqual(['U-2'])
    expect(m.complete).toBe(false)
  })

  it('reports both directions at once rather than stopping at the first', () => {
    const m = coverageMatrix(
      order(
        ['AC-1', 'AC-2'],
        [
          { id: 'U-1', satisfies: ['AC-1'] },
          { id: 'U-2', satisfies: [] },
        ]
      )
    )
    expect(m.uncoveredCriteria).toEqual(['AC-2'])
    expect(m.orphanUnits).toEqual(['U-2'])
  })

  it('catches a unit pointing at a criterion that does not exist', () => {
    const m = coverageMatrix(order(['AC-1'], [{ id: 'U-1', satisfies: ['AC-1', 'AC-9'] }]))
    expect(m.danglingRefs).toEqual([{ unitId: 'U-1', criterionId: 'AC-9' }])
    expect(m.complete).toBe(false)
  })

  it('does not let a dangling reference count as attaching a unit to something', () => {
    const m = coverageMatrix(order(['AC-1'], [{ id: 'U-1', satisfies: ['AC-9'] }]))
    expect(m.orphanUnits).toEqual(['U-1'])
    expect(m.uncoveredCriteria).toEqual(['AC-1'])
  })

  it('lays out a grid a surface can render directly', () => {
    const m = coverageMatrix(
      order(
        ['AC-1', 'AC-2'],
        [
          { id: 'U-1', satisfies: ['AC-1'] },
          { id: 'U-2', satisfies: ['AC-2'] },
        ]
      )
    )
    expect(m.criteria).toEqual(['AC-1', 'AC-2'])
    expect(m.units).toEqual(['U-1', 'U-2'])
    expect(m.cells).toEqual([
      [true, false],
      [false, true],
    ])
  })

  it('treats an empty order as incomplete — there is nothing to prove', () => {
    const m = coverageMatrix(order([], []))
    expect(m.complete).toBe(false)
    expect(m.reason).toMatch(/no acceptance criteria/i)
  })

  it('treats criteria with no plan at all as incomplete', () => {
    const m = coverageMatrix(order(['AC-1'], []))
    expect(m.complete).toBe(false)
    expect(m.uncoveredCriteria).toEqual(['AC-1'])
  })

  it('counts a criterion covered by more than one unit once', () => {
    const m = coverageMatrix(
      order(
        ['AC-1'],
        [
          { id: 'U-1', satisfies: ['AC-1'] },
          { id: 'U-2', satisfies: ['AC-1'] },
        ]
      )
    )
    expect(m.complete).toBe(true)
    expect(m.cells).toEqual([[true, true]])
  })
})
