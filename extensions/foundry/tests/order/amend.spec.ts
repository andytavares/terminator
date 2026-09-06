import { describe, it, expect } from 'vitest'
import { amendOrder, addRedTeamFinding } from '../../src/order/amend.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// An amendment sets the order back to draft and re-runs every check. Running
// work pauses rather than being abandoned: work done against an order that has
// since changed may still be valid, and throwing it away because a sentence
// moved is expensive.
//
// Identifiers never change. Ledger entries, verdicts and gates all reference
// them, so renumbering on amendment would silently orphan the record of what
// happened.

function agreed(): WorkOrder {
  const base = draftOrder({
    id: 'WO-0101-aaa',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'agreed',
    agreedAt: '2026-09-06T11:00:00.000Z',
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a',
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
      ],
    },
  }
}

describe('amendOrder', () => {
  it('returns an agreed order to draft', () => {
    const after = amendOrder(agreed(), { reason: 'scope changed', at: '2026-09-06T12:00:00.000Z' })
    expect(after.status).toBe('draft')
    expect(after.agreedAt).toBeNull()
  })

  it('records what changed and why', () => {
    const after = amendOrder(agreed(), { reason: 'scope changed', at: '2026-09-06T12:00:00.000Z' })
    expect(after.provenance.amendments).toHaveLength(1)
    expect(after.provenance.amendments[0]).toContain('scope changed')
    expect(after.provenance.amendments[0]).toContain('2026-09-06T12:00:00.000Z')
  })

  it('keeps every identifier stable, so the record of what happened still resolves', () => {
    const before = agreed()
    const after = amendOrder(before, { reason: 'x', at: '2026-09-06T12:00:00.000Z' })
    expect(after.acceptance.map((a) => a.id)).toEqual(before.acceptance.map((a) => a.id))
    expect(after.plan.units.map((u) => u.id)).toEqual(before.plan.units.map((u) => u.id))
    expect(after.id).toBe(before.id)
  })

  it('applies a change alongside the amendment', () => {
    const after = amendOrder(agreed(), {
      reason: 'added a criterion',
      at: '2026-09-06T12:00:00.000Z',
      change: (o) => ({
        ...o,
        acceptance: [
          ...o.acceptance,
          {
            id: 'AC-2',
            statement: 'b',
            priority: 'P2' as const,
            verify: { kind: 'test' as const, command: 'npm test', assert: 'exit_code == 0' },
            unverifiable: null,
          },
        ],
      }),
    })
    expect(after.acceptance.map((a) => a.id)).toEqual(['AC-1', 'AC-2'])
    expect(after.status).toBe('draft')
  })

  it('accumulates amendments rather than replacing the last one', () => {
    const once = amendOrder(agreed(), { reason: 'first', at: '2026-09-06T12:00:00.000Z' })
    const twice = amendOrder(once, { reason: 'second', at: '2026-09-06T13:00:00.000Z' })
    expect(twice.provenance.amendments).toHaveLength(2)
  })

  it('amends a draft too — a draft that changes is still a change worth recording', () => {
    const after = amendOrder(
      draftOrder({
        id: 'WO-1',
        title: 'x',
        source: { kind: 'typed', tracker: null, key: null, url: null },
        repoPaths: ['/repos/a'],
        now: '2026-09-06T10:00:00.000Z',
      }),
      { reason: 'x', at: '2026-09-06T12:00:00.000Z' }
    )
    expect(after.provenance.amendments).toHaveLength(1)
  })

  it('does not mutate the order it was given', () => {
    const before = agreed()
    amendOrder(before, { reason: 'x', at: '2026-09-06T12:00:00.000Z' })
    expect(before.status).toBe('agreed')
    expect(before.provenance.amendments).toEqual([])
  })
})

describe('addRedTeamFinding', () => {
  it('sends an agreed order back to draft — a late finding gets no quieter path', () => {
    const after = addRedTeamFinding(agreed(), {
      id: 'RT-1',
      severity: 'high',
      text: 'AC-1 is ambiguous about resize',
      at: '2026-09-06T12:00:00.000Z',
    })
    expect(after.status).toBe('draft')
    expect(after.redTeam).toHaveLength(1)
    expect(after.redTeam[0].status).toBe('open')
  })

  it('records the finding as an amendment, so the reason it reopened is legible', () => {
    const after = addRedTeamFinding(agreed(), {
      id: 'RT-1',
      severity: 'low',
      text: 'x',
      at: '2026-09-06T12:00:00.000Z',
    })
    expect(after.provenance.amendments[0]).toMatch(/RT-1/)
  })

  it('leaves a draft as a draft, and still records the finding', () => {
    const draft = draftOrder({
      id: 'WO-1',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    })
    const after = addRedTeamFinding(draft, {
      id: 'RT-1',
      severity: 'low',
      text: 'x',
      at: '2026-09-06T12:00:00.000Z',
    })
    expect(after.status).toBe('draft')
    expect(after.redTeam).toHaveLength(1)
  })
})
