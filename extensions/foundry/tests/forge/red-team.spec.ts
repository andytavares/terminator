import { describe, it, expect } from 'vitest'
import {
  structuralFindings,
  applyFindings,
  resolveFinding,
  acceptFinding,
} from '../../src/forge/red-team.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The adversarial pass reads the order and nothing else — never the intake
// conversation, because a reviewer who watched the draft being justified has
// already been persuaded by it.
//
// What lives here is the deterministic half: structural attacks that never
// need a model and never disagree with themselves. An agent pass adds
// judgement on top, but these fire every time and cost nothing.

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-0101-aaa',
    title: 'Terminal clips the last glyph',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    intent: {
      problem: 'rows are clipped',
      outcome: 'rows are not clipped',
      nonGoals: ['scrollbar styling'],
    },
    // A well-formed order has been through Scout, so its toolchain is filled.
    // Leaving it empty here would make every fixture trip `no-runnable-check`.
    context: {
      ...base.context,
      toolchain: {
        ...base.context.toolchain,
        test: { command: 'npm test', source: 'package.json' as const },
      },
    },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a full-width row renders its final glyph',
        priority: 'P0',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'widen the row',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/a.css'],
          verify: [],
        },
      ],
    },
    ...over,
  }
}

function ids(o: WorkOrder): string[] {
  return structuralFindings(o).map((f) => f.rule)
}

describe('structuralFindings', () => {
  it('finds nothing wrong with a well-formed order', () => {
    expect(structuralFindings(order())).toEqual([])
  })

  it('attacks an outcome that just restates the problem', () => {
    const o = order({
      intent: { problem: 'the thing is broken', outcome: 'the thing is broken', nonGoals: [] },
    })
    expect(ids(o)).toContain('outcome-restates-problem')
  })

  it('attacks an order that declares nothing out of scope', () => {
    const o = order({ intent: { problem: 'p', outcome: 'o', nonGoals: [] } })
    expect(ids(o)).toContain('no-non-goals')
  })

  it('attacks a criterion whose statement is not falsifiable', () => {
    const o = order()
    o.acceptance[0].statement = 'the terminal works better'
    expect(ids(o)).toContain('unfalsifiable-statement')
  })

  it('names the criterion it is attacking', () => {
    const o = order()
    o.acceptance[0].statement = 'it should be nicer'
    const finding = structuralFindings(o).find((f) => f.rule === 'unfalsifiable-statement')
    expect(finding?.subjectIds).toEqual(['AC-1'])
  })

  it('attacks a unit that declares it will touch nothing', () => {
    const o = order()
    o.plan.units[0].touches = []
    expect(ids(o)).toContain('unit-touches-nothing')
  })

  it('attacks a dependency chain with no parallelism when there is more than one unit', () => {
    const o = order()
    o.plan.units = [
      {
        id: 'U-1',
        title: 'a',
        role: 'builder',
        lane: 1,
        dependsOn: [],
        satisfies: ['AC-1'],
        touches: ['src/a'],
        verify: [],
      },
      {
        id: 'U-2',
        title: 'b',
        role: 'builder',
        lane: 1,
        dependsOn: ['U-1'],
        satisfies: ['AC-1'],
        touches: ['src/b'],
        verify: [],
      },
      {
        id: 'U-3',
        title: 'c',
        role: 'builder',
        lane: 1,
        dependsOn: ['U-2'],
        satisfies: ['AC-1'],
        touches: ['src/c'],
        verify: [],
      },
      {
        id: 'U-4',
        title: 'd',
        role: 'builder',
        lane: 1,
        dependsOn: ['U-3'],
        satisfies: ['AC-1'],
        touches: ['src/d'],
        verify: [],
      },
    ]
    expect(ids(o)).toContain('fully-serial-plan')
  })

  it('attacks a P0 criterion proved only by a judgement', () => {
    const o = order()
    o.acceptance[0].verify = { kind: 'judge', rubric: 'looks right', evidence: ['screenshot'] }
    expect(ids(o)).toContain('p0-judged-not-run')
  })

  it('leaves a P2 criterion proved by a judgement alone', () => {
    const o = order()
    o.acceptance[0].priority = 'P2'
    o.acceptance[0].verify = { kind: 'judge', rubric: 'looks right', evidence: ['screenshot'] }
    expect(ids(o)).not.toContain('p0-judged-not-run')
  })

  it('attacks a plan that touches a file no criterion could be about', () => {
    const o = order()
    o.plan.units[0].touches = ['src/a.css', '.github/workflows/release.yml']
    expect(ids(o)).toContain('touches-release-machinery')
  })

  it('attacks an order whose every check is unavailable, since nothing can prove it', () => {
    const o = order()
    o.context.toolchain.test = null
    expect(ids(o)).toContain('no-runnable-check')
  })

  it('does not raise the unavailable-check finding when the repository has a test command', () => {
    expect(ids(order())).not.toContain('no-runnable-check')
  })
})

describe('applyFindings', () => {
  it('adds every finding as open, so none can be forgotten', () => {
    const o = applyFindings(
      order({ intent: { problem: 'p', outcome: 'p', nonGoals: [] } }),
      '2026-09-06T12:00:00.000Z'
    )
    expect(o.redTeam.length).toBeGreaterThan(0)
    expect(o.redTeam.every((f) => f.status === 'open')).toBe(true)
  })

  it('returns an agreed order to draft, because findings are as binding as the checks', () => {
    const agreed: WorkOrder = {
      ...order({ intent: { problem: 'p', outcome: 'p', nonGoals: [] } }),
      status: 'agreed',
    }
    expect(applyFindings(agreed, '2026-09-06T12:00:00.000Z').status).toBe('draft')
  })

  it('leaves a clean order untouched rather than reopening it for nothing', () => {
    const after = applyFindings({ ...order(), status: 'agreed' }, '2026-09-06T12:00:00.000Z')
    expect(after.redTeam).toEqual([])
    expect(after.status).toBe('agreed')
  })

  it('does not raise the same finding twice across two passes', () => {
    const dirty = order({ intent: { problem: 'p', outcome: 'p', nonGoals: [] } })
    const once = applyFindings(dirty, '2026-09-06T12:00:00.000Z')
    const twice = applyFindings(once, '2026-09-06T13:00:00.000Z')
    expect(twice.redTeam).toHaveLength(once.redTeam.length)
  })
})

describe('resolveFinding and acceptFinding', () => {
  const dirty = (): WorkOrder => order({ intent: { problem: 'p', outcome: 'p', nonGoals: [] } })

  it('resolves a finding', () => {
    const o = applyFindings(dirty(), '2026-09-06T12:00:00.000Z')
    const after = resolveFinding(o, o.redTeam[0].id)
    expect(after.redTeam[0].status).toBe('resolved')
  })

  it('accepts a finding, and keeps the reason with it', () => {
    const o = applyFindings(dirty(), '2026-09-06T12:00:00.000Z')
    const after = acceptFinding(o, o.redTeam[0].id, 'deliberate for this order')
    expect(after.redTeam[0].status).toBe('accepted')
    expect(after.redTeam[0].reason).toBe('deliberate for this order')
  })

  it('refuses to accept a finding with no reason, leaving it open', () => {
    const o = applyFindings(dirty(), '2026-09-06T12:00:00.000Z')
    const after = acceptFinding(o, o.redTeam[0].id, '   ')
    expect(after.redTeam[0].status).toBe('open')
  })

  it('ignores an unknown finding id rather than throwing', () => {
    const o = applyFindings(dirty(), '2026-09-06T12:00:00.000Z')
    expect(() => resolveFinding(o, 'RT-nope')).not.toThrow()
  })
})
