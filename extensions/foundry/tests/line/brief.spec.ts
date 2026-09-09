import { describe, it, expect } from 'vitest'
import { brief, READABLE } from '../../src/line/brief.js'
import { draftOrder } from '../../src/order/schema.js'
import type { PlanUnit, WorkOrder } from '../../src/order/schema.js'
import type { Role, Rule } from '../../src/recipe/parse.js'

// What an agent is actually told.
//
// A role's prompt says how to work and names no work. An agent launched with
// the bare prompt is a builder that knows it is a builder and nothing else,
// which is the shape of every "it did the wrong thing" failure — and not
// something a better prompt fixes.

function role(over: Partial<Role> = {}): Role {
  return {
    schemaVersion: 1,
    id: 'builder',
    modelTier: 'deep',
    allowResume: true,
    reads: ['unit', 'context', 'rules'],
    writes: ['worktree'],
    tools: ['read', 'edit'],

    prompt: 'Build one unit, in its own worktree, and nothing else.',
    ...over,
  }
}

function unit(over: Partial<PlanUnit> = {}): PlanUnit {
  return {
    id: 'U-1',
    title: 'refuse an expired token',
    role: 'builder',
    lane: 1,
    dependsOn: [],
    satisfies: ['AC-1'],
    touches: ['src/auth/session.ts'],
    verify: [],
    ...over,
  }
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    intent: {
      problem: 'an expired refresh token is accepted',
      outcome: 'it is refused with a 401',
      nonGoals: ['rotating the signing key'],
    },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'an expired token is refused',
        priority: 'P0',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    context: {
      ...base.context,
      toolchain: {
        ...base.context.toolchain,
        test: { command: 'npm test', source: 'package.json' },
      },
      houseDocs: ['CLAUDE.md'],
    },
    plan: { ...base.plan, units: [unit()] },
    ...over,
  }
}

const RULE: Rule = {
  schemaVersion: 1,
  id: 'no-stubs',
  scope: 'universal',
  rung: 'L3',
  asserts: 'No TODO, and no function that throws instead of doing the thing.',
  appliesWhen: 'always',
  origin: 'built-in',
}

describe('the instruction', () => {
  it("leads with the role's own prompt", () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [] })
    expect(text.startsWith('Build one unit')).toBe(true)
  })

  it('names the order, the problem and what done looks like', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [] })
    expect(text).toContain('Refuse an expired refresh token')
    expect(text).toContain('an expired refresh token is accepted')
    expect(text).toContain('it is refused with a 401')
  })

  it('names what is explicitly not being asked for', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [] })
    expect(text).toContain('rotating the signing key')
  })

  it('carries the risk grade, which decides what happens around it', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [] })
    expect(text).toMatch(/risk P3/)
  })
})

describe('what each role may read is declared, not assumed', () => {
  it('gives a builder its unit, what it may touch and what makes it done', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [] })
    expect(text).toContain('U-1')
    expect(text).toContain('src/auth/session.ts')
    expect(text).toContain('AC-1')
    expect(text).toContain('an expired token is refused')
  })

  // A fan-out `by lane` gives one agent a whole lane. The plan's detail is
  // the point of keeping units at all, so the brief lists every one of them,
  // in the order the graph resolved — not a summary and not just the first.
  it('lists every unit a lane node carries, in the order it was given them', () => {
    const text = brief({
      order: order(),
      role: role(),
      units: [
        unit({ id: 'U-1', title: 'first', touches: ['src/a.ts'] }),
        unit({ id: 'U-2', title: 'second', touches: ['src/b.ts'] }),
      ],
      rules: [],
    })
    expect(text.indexOf('U-1')).toBeLessThan(text.indexOf('U-2'))
    expect(text).toContain('src/a.ts')
    expect(text).toContain('src/b.ts')
  })

  it('says a lane is one agent doing several units in order, not a menu', () => {
    const text = brief({
      order: order(),
      role: role(),
      units: [unit({ id: 'U-1' }), unit({ id: 'U-2' })],
      rules: [],
    })
    expect(text).toContain('## The units: U-1, U-2')
    expect(text).toContain('in the order they are listed')
  })

  it('still names a single unit in the singular', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [] })
    expect(text).toContain('## The unit: U-1')
  })

  it('gives a verifier the criteria and never the unit — that is the whole point', () => {
    const verifier = role({ id: 'verifier', reads: ['criteria'], writes: [], allowResume: false })
    const text = brief({ order: order(), role: verifier, units: [unit()], rules: [] })
    expect(text).toContain('AC-1')
    expect(text).not.toContain('src/auth/session.ts')
    expect(text).not.toContain('The unit:')
  })

  it('gives a role that reads nothing its prompt and the order, and no more', () => {
    const bare = role({ reads: [] })
    const text = brief({ order: order(), role: bare, units: [unit()], rules: [RULE] })
    expect(text).toContain('Refuse an expired refresh token')
    expect(text).not.toContain('no-stubs')
    expect(text).not.toContain('src/auth/session.ts')
  })

  it('offers a closed set of things a role can ask for', () => {
    expect([...READABLE]).toEqual(['unit', 'criteria', 'context', 'rules', 'order', 'conventions'])
  })
})

describe('the repository, for a role that reads it', () => {
  it('names the real commands and forbids inventing others', () => {
    const runs = role({ tools: ['read', 'edit', 'run_tests'] })
    const text = brief({ order: order(), role: runs, units: [unit()], rules: [] })
    expect(text).toContain('npm test')
    expect(text).toContain('do not invent others')
  })

  // The architect was handed "use these; do not invent others" and then refused
  // `npm test` by the read-only policy. It tried three times and spent its
  // turns on an instruction the factory would never have let it follow.
  it('tells a role that may not run them that they are run for it', () => {
    const reads = role({ tools: ['read', 'search'] })
    const text = brief({ order: order(), role: reads, units: [unit()], rules: [] })
    expect(text).toContain('npm test')
    expect(text).toContain('run for you')
    expect(text).not.toContain('do not invent others')
  })

  it('says so when there are none, rather than leaving the agent to guess', () => {
    const bare = order()
    const text = brief({
      order: {
        ...bare,
        context: {
          ...bare.context,
          toolchain: Object.fromEntries(
            Object.keys(bare.context.toolchain).map((k) => [k, null])
          ) as typeof bare.context.toolchain,
        },
      },
      role: role(),
      units: [unit()],
      rules: [],
    })
    expect(text).toContain('No commands were found')
    expect(text).toMatch(/inventing a command turns that into a false pass/)
  })

  it('points at what the project says about itself', () => {
    expect(brief({ order: order(), role: role(), units: [unit()], rules: [] })).toContain(
      'CLAUDE.md'
    )
  })

  it('carries what was already decided about these files', () => {
    const base = order()
    const text = brief({
      order: {
        ...base,
        context: { ...base.context, priorArt: ['2026-08-01 operator: review.rejected — no'] },
      },
      role: role(),
      units: [unit()],
      rules: [],
    })
    expect(text).toContain('Already decided about these files')
  })

  it('carries the assumptions, and says to stop rather than work around one', () => {
    const base = order()
    const text = brief({
      order: {
        ...base,
        assumptions: [
          { id: 'A-1', text: 'sessions are stored in Redis', struck: false, affects: [] },
        ],
      },
      role: role(),
      units: [unit()],
      rules: [],
    })
    expect(text).toContain('sessions are stored in Redis')
    expect(text).toContain('stop and say so')
  })

  it('leaves out an assumption the operator struck', () => {
    const base = order()
    const text = brief({
      order: {
        ...base,
        assumptions: [{ id: 'A-1', text: 'sessions are in Redis', struck: true, affects: [] }],
      },
      role: role(),
      units: [unit()],
      rules: [],
    })
    expect(text).not.toContain('sessions are in Redis')
  })
})

describe('house rules', () => {
  it('are named with the rung they sit on', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [RULE] })
    expect(text).toContain('no-stubs')
    expect(text).toContain('L3')
  })

  it('produce no section when there are none', () => {
    expect(brief({ order: order(), role: role(), units: [unit()], rules: [] })).not.toContain(
      'House rules'
    )
  })
})

describe('a command step', () => {
  it('is the command and an instruction not to reinterpret it', () => {
    const text = brief({
      order: order(),
      role: null,
      units: [],
      rules: [RULE],
      command: 'npm test',
    })
    expect(text).toContain('npm test')
    expect(text).toContain('Do not fix what it reports')
    // No order, no rules, no unit — wrapping a command in context is an
    // invitation to reinterpret it.
    expect(text).not.toContain('Refuse an expired refresh token')
    expect(text).not.toContain('no-stubs')
  })

  it('falls through to the ordinary brief for an empty command', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [], command: '   ' })
    expect(text).toContain('Build one unit')
  })
})

describe('a unit with nothing declared', () => {
  it('says touching anything is a trigger, rather than saying nothing', () => {
    const text = brief({
      order: order(),
      role: role(),
      units: [unit({ touches: [] })],
      rules: [],
    })
    expect(text).toContain('declared no files')
  })

  it('says so when a unit satisfies no criterion', () => {
    const text = brief({
      order: order(),
      role: role(),
      units: [unit({ satisfies: [] })],
      rules: [],
    })
    expect(text).toContain('satisfies no criterion')
  })
})

describe('where a rung hands back what it found', () => {
  it('tells a read-only role the file, and that nothing else counts', () => {
    const text = brief({
      order: order(),
      role: role({ id: 'scout', writes: ['context'], tools: ['read'] }),
      units: [],
      rules: [],
      outputPath: '/data/orders/WO-1/rungs/scout.json',
    })
    expect(text).toContain('/data/orders/WO-1/rungs/scout.json')
    expect(text).toContain('Nothing else you do counts')
  })

  it('offers only the artefacts that role declared it writes', () => {
    const text = brief({
      order: order(),
      role: role({ id: 'red-team', writes: ['findings'], tools: ['read'] }),
      units: [],
      rules: [],
      outputPath: '/rungs/challenge.json',
    })
    expect(text).toContain('"redTeam"')
    expect(text).not.toContain('"entryPoints"')
  })

  it('says nothing to a role whose product is the diff', () => {
    // The builder writes the worktree. A second channel would be two answers
    // to the question of what the rung did.
    const text = brief({
      order: order(),
      role: role(),
      units: [unit()],
      rules: [],
      outputPath: '/rungs/build.json',
    })
    expect(text).not.toContain('What to write, and where')
  })

  it('says nothing when the caller keeps no rung output', () => {
    const text = brief({
      order: order(),
      role: role({ id: 'scout', writes: ['context'], tools: ['read'] }),
      units: [],
      rules: [],
    })
    expect(text).not.toContain('What to write, and where')
  })

  it('is the last thing an agent reads', () => {
    // After the assumptions, which end with "stop and say so rather than
    // working around it" — the instruction that most often produces one.
    const text = brief({
      order: order({
        assumptions: [{ id: 'A-1', text: 'the token is a JWT', struck: false, affects: [] }],
      }),
      role: role({ id: 'scout', reads: ['context'], writes: ['context'], tools: ['read'] }),
      units: [],
      rules: [],
      outputPath: '/rungs/scout.json',
    })
    expect(text).toContain('Assumed, and not verified')
    expect(text.indexOf('What to write, and where')).toBeGreaterThan(
      text.indexOf('Assumed, and not verified')
    )
  })
})
