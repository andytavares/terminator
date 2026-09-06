import { describe, it, expect } from 'vitest'
import {
  parseWorkOrder,
  SCHEMA_VERSION,
  SchemaVersionTooNewError,
  draftOrder,
} from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The order is written by an agent and edited through a surface, so nothing
// here trusts it on read. The version rule is deliberately strict: a reader
// that meets a version it does not know refuses the order outright, because a
// half-understood agreement is worse than an unreadable one — the failure mode
// of a partial read is a plan executed against terms nobody agreed to.

function valid(): unknown {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'WO-0913-c71',
    title: 'Terminal clips the last glyph of every row',
    status: 'draft',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    writeBack: ['summary_comment'],
    recipe: null,
    recipeOverriddenBy: null,
    intent: { problem: 'p', outcome: 'o', nonGoals: [] },
    context: {
      repos: [
        {
          name: 'terminator',
          path: '/repos/terminator',
          lane: 1,
          baseBranch: 'main',
          headBranch: 'x',
        },
      ],
      toolchain: { test: null, lint: null, format: null, coverage: null, e2e: null, build: null },
      entryPoints: [],
      priorArt: [],
      conventions: [],
      houseDocs: [],
    },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a full-width row renders its final glyph',
        priority: 'P0',
        verify: { kind: 'test', command: 'npx vitest run', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] },
    budgets: { agents: 3, wallClockMinutes: 45, filesTouched: 25, tokens: null },
    plan: {
      units: [
        {
          id: 'U-1',
          title: 'fix',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/a.css'],
          verify: [],
        },
      ],
      lanes: [{ ord: 1, repo: 'terminator', branch: 'x', role: null, blocks: [], blockedBy: [] }],
      sharedFiles: [],
    },
    assumptions: [],
    openQuestions: [],
    redTeam: [],
    provenance: { forgeSession: null, decisions: [], amendments: [] },
    createdAt: '2026-09-06T10:00:00.000Z',
    agreedAt: null,
  }
}

describe('parseWorkOrder', () => {
  it('accepts a well-formed order', () => {
    const order = parseWorkOrder(valid())
    expect(order.id).toBe('WO-0913-c71')
    expect(order.status).toBe('draft')
  })

  it('refuses a schema version newer than it knows, rather than reading what it recognises', () => {
    const future = { ...(valid() as Record<string, unknown>), schemaVersion: SCHEMA_VERSION + 1 }
    expect(() => parseWorkOrder(future)).toThrow(SchemaVersionTooNewError)
  })

  it('names the version it met and the version it knows', () => {
    const future = { ...(valid() as Record<string, unknown>), schemaVersion: 99 }
    expect(() => parseWorkOrder(future)).toThrow(/99/)
  })

  // Shape and completeness are different questions, and they are answered in
  // different places. An order with no criteria, no units, or a unit that
  // satisfies nothing is well-formed but incomplete: the schema accepts it so
  // that a draft can legitimately start empty, and the six compile checks are
  // what refuse to hand it off (FR-010). Putting completeness here instead
  // would make an empty draft unrepresentable.

  it('accepts an order with no acceptance criteria — a draft starts empty', () => {
    const o = valid() as Record<string, unknown>
    o.acceptance = []
    expect(() => parseWorkOrder(o)).not.toThrow()
  })

  it('accepts an order with no plan units, leaving that to the compile checks', () => {
    const o = valid() as Record<string, unknown>
    ;(o.plan as Record<string, unknown>).units = []
    expect(() => parseWorkOrder(o)).not.toThrow()
  })

  it('accepts a unit that satisfies nothing — an orphan unit fails compile, not parsing', () => {
    const o = valid() as Record<string, unknown>
    const plan = o.plan as { units: Record<string, unknown>[] }
    plan.units[0].satisfies = []
    expect(() => parseWorkOrder(o)).not.toThrow()
  })

  it('rejects an unknown status', () => {
    const o = valid() as Record<string, unknown>
    o.status = 'nearly'
    expect(() => parseWorkOrder(o)).toThrow()
  })

  it('keeps toolchain nulls as nulls rather than dropping the keys', () => {
    const order = parseWorkOrder(valid())
    expect(Object.hasOwn(order.context.toolchain, 'coverage')).toBe(true)
    expect(order.context.toolchain.coverage).toBeNull()
  })

  it('normalises an absent lane blocks list to an empty one', () => {
    const o = valid() as Record<string, unknown>
    const plan = o.plan as { lanes: Record<string, unknown>[] }
    delete plan.lanes[0].blocks
    delete plan.lanes[0].blockedBy
    const order = parseWorkOrder(o)
    expect(order.plan.lanes[0].blocks).toEqual([])
    expect(order.plan.lanes[0].blockedBy).toEqual([])
  })

  it('accepts a criterion accepted as unverifiable when it carries a reason', () => {
    const o = valid() as Record<string, unknown>
    const acc = o.acceptance as Record<string, unknown>[]
    acc[0].verify = { kind: 'judge', rubric: 'looks right', evidence: ['screenshot'] }
    acc[0].unverifiable = { accepted: true, reason: 'no runner exists for this' }
    expect(() => parseWorkOrder(o)).not.toThrow()
  })

  it('rejects an unverifiable escape with no reason', () => {
    const o = valid() as Record<string, unknown>
    const acc = o.acceptance as Record<string, unknown>[]
    acc[0].unverifiable = { accepted: true, reason: '' }
    expect(() => parseWorkOrder(o)).toThrow()
  })

  it.each([null, undefined, 'an order', 42, []])(
    'rejects %p, which is not an order at all',
    (v) => {
      expect(() => parseWorkOrder(v)).toThrow()
    }
  )

  it('does not mistake a non-numeric schemaVersion for a version it can compare', () => {
    const o = { ...(valid() as Record<string, unknown>), schemaVersion: 'one' }
    // Not a SchemaVersionTooNewError — it is simply malformed, and the shape
    // check is what should say so.
    expect(() => parseWorkOrder(o)).toThrow()
    expect(() => parseWorkOrder(o)).not.toThrow(SchemaVersionTooNewError)
  })

  it('accepts the version it knows', () => {
    const o = { ...(valid() as Record<string, unknown>), schemaVersion: SCHEMA_VERSION }
    expect(parseWorkOrder(o).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('fills the optional collections rather than leaving them undefined', () => {
    const o = valid() as Record<string, unknown>
    delete o.assumptions
    delete o.openQuestions
    delete o.redTeam
    delete o.writeBack
    delete o.recipe
    delete o.recipeOverriddenBy
    delete o.agreedAt
    const order = parseWorkOrder(o)
    expect(order.assumptions).toEqual([])
    expect(order.openQuestions).toEqual([])
    expect(order.redTeam).toEqual([])
    expect(order.writeBack).toEqual([])
    expect(order.recipe).toBeNull()
    expect(order.recipeOverriddenBy).toBeNull()
    expect(order.agreedAt).toBeNull()
  })

  it('fills a unit and a criterion with their optional fields', () => {
    const o = valid() as Record<string, unknown>
    const plan = o.plan as { units: Record<string, unknown>[] }
    delete plan.units[0].dependsOn
    delete plan.units[0].touches
    delete plan.units[0].verify
    const acc = o.acceptance as Record<string, unknown>[]
    delete acc[0].unverifiable
    const order = parseWorkOrder(o)
    expect(order.plan.units[0].dependsOn).toEqual([])
    expect(order.plan.units[0].touches).toEqual([])
    expect(order.plan.units[0].verify).toEqual([])
    expect(order.acceptance[0].unverifiable).toBeNull()
  })

  it('defaults a risk assessment to no triggers and nothing declared critical', () => {
    const o = valid() as Record<string, unknown>
    o.risk = { grade: 'P3' }
    const order = parseWorkOrder(o)
    expect(order.risk.triggers).toEqual([])
    expect(order.risk.blastRadius).toEqual([])
    expect(order.risk.criticalPaths).toEqual([])
  })

  it('defaults a token budget to unset, since a ceiling mid-unit leaves half a change', () => {
    const o = valid() as Record<string, unknown>
    delete (o.budgets as Record<string, unknown>).tokens
    expect(parseWorkOrder(o).budgets.tokens).toBeNull()
  })

  it('accepts every kind of proof a criterion can carry', () => {
    const kinds = [
      { kind: 'command', command: 'make check', assert: 'exit_code == 0' },
      { kind: 'judge', rubric: 'measure ink', evidence: ['screenshot'] },
      { kind: 'artifact', path: 'dist/app.js', assert: 'exists' },
      { kind: 'screenshot', target: 'terminal pane' },
    ]
    for (const verify of kinds) {
      const o = valid() as Record<string, unknown>
      ;(o.acceptance as Record<string, unknown>[])[0].verify = verify
      expect(() => parseWorkOrder(o)).not.toThrow()
    }
  })

  it('rejects a judge with no evidence to judge from', () => {
    const o = valid() as Record<string, unknown>
    ;(o.acceptance as Record<string, unknown>[])[0].verify = {
      kind: 'judge',
      rubric: 'looks right',
      evidence: [],
    }
    expect(() => parseWorkOrder(o)).toThrow()
  })

  it('rejects a red-team finding accepted without a reason, and keeps one with', () => {
    const o = valid() as Record<string, unknown>
    o.redTeam = [{ id: 'RT-1', text: 'ambiguous', status: 'accepted', reason: '' }]
    expect(() => parseWorkOrder(o)).toThrow()
    o.redTeam = [{ id: 'RT-1', text: 'ambiguous', status: 'accepted', reason: 'out of scope' }]
    expect(() => parseWorkOrder(o)).not.toThrow()
  })

  it('leaves an open red-team finding alone, since it needs no reason yet', () => {
    const o = valid() as Record<string, unknown>
    o.redTeam = [{ id: 'RT-1', text: 'ambiguous' }]
    const order = parseWorkOrder(o)
    expect(order.redTeam[0].status).toBe('open')
  })

  it('rejects an order that names no repository', () => {
    const o = valid() as Record<string, unknown>
    ;(o.context as Record<string, unknown>).repos = []
    expect(() => parseWorkOrder(o)).toThrow()
  })
})

describe('draftOrder', () => {
  it('builds a draft that parses, so the Forge always starts from a valid document', () => {
    const o = draftOrder({
      id: 'WO-0101-aaa',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/terminator'],
      now: '2026-09-06T10:00:00.000Z',
    })
    expect(() => parseWorkOrder(o as unknown)).not.toThrow()
    expect(o.status).toBe('draft')
    expect(o.agreedAt).toBeNull()
  })

  it('carries one lane per repository', () => {
    const o: WorkOrder = draftOrder({
      id: 'WO-0101-aaa',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a', '/repos/b'],
      now: '2026-09-06T10:00:00.000Z',
    })
    expect(o.plan.lanes.map((l) => l.ord)).toEqual([1, 2])
    expect(o.context.repos.map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('defaults the base branch to main, and takes one when given', () => {
    const common = {
      id: 'WO-0101-aaa',
      title: 'x',
      source: { kind: 'typed' as const, tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    }
    expect(draftOrder(common).context.repos[0].baseBranch).toBe('main')
    expect(draftOrder({ ...common, baseBranch: 'develop' }).context.repos[0].baseBranch).toBe(
      'develop'
    )
  })

  it('starts with every toolchain check unknown, so nothing is assumed before Scout runs', () => {
    const o = draftOrder({
      id: 'WO-0101-aaa',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    })
    expect(Object.values(o.context.toolchain).every((v) => v === null)).toBe(true)
  })

  it('starts with nothing agreed: no criteria, no units, no recipe', () => {
    const o = draftOrder({
      id: 'WO-0101-aaa',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    })
    expect(o.acceptance).toEqual([])
    expect(o.plan.units).toEqual([])
    expect(o.recipe).toBeNull()
  })
})
