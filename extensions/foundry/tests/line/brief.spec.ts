import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { createRoleRegistry } from '../../src/line/roles.js'
import { rulesFor } from '../../src/verify/rules.js'
import { testCriterion } from '../helpers/order-parts.js'
import { brief } from '../../src/line/brief.js'
import { draftOrder } from '../../src/order/draft.js'
import type { PlanUnit, WorkOrder } from '../../src/order/schema.js'
import type { Role, Rule } from '../../src/recipe/parse.js'
import type { Feedback } from '../../src/line/run-graph.js'

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
    skills: [],
    modelTier: 'deep',
    allowResume: true,
    reads: ['unit', 'context', 'rules', 'feedback'],
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
      testCriterion('AC-1', { statement: 'an expired token is refused', priority: 'P0' }),
    ],
    context: {
      ...base.context,
      toolchain: {
        ...base.context.toolchain,
        test: { command: 'npm test', source: 'hint' },
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

describe('a node with no role', () => {
  it('gets the order and nothing it would have to be permitted to read', () => {
    const text = brief({ order: order(), role: null, units: [unit()], rules: [] })
    expect(text.startsWith('---')).toBe(true)
    expect(text).toContain('# Refuse an expired refresh token')
    expect(text).toContain('it is refused with a 401')
    expect(text).not.toContain('## The unit:')
    expect(text).not.toContain('## The repository')
  })

  it('has no output contract to end on', () => {
    const text = brief({
      order: order(),
      role: null,
      units: [],
      rules: [],
      outputPath: '/data/orders/WO-1/rungs/x.json',
    })
    expect(text).not.toContain('What to write, and where')
  })
})

describe('what each role may read is declared, not assumed', () => {
  describe('the builder brief', theBuilderBriefTests)
  describe('open findings', briefOpenFindingsTests)
  describe('blocking findings', briefBlockingFindingsTests)
  describe('lanes', briefLanesTests)
  describe('verifiers and silent roles', verifiersAndSilentRolesTests)
})

function theBuilderBriefTests() {
  it('gives a builder its unit, what it may touch and what makes it done', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [] })
    expect(text).toContain('U-1')
    expect(text).toContain('src/auth/session.ts')
    expect(text).toContain('AC-1')
    expect(text).toContain('an expired token is refused')
  })
}

function briefOpenFindingsTests() {
  it('tells a builder about an open non-blocking finding, and to leave it if it is not theirs', () => {
    const text = brief({
      order: order({
        redTeam: [
          {
            id: 'RT-1',
            severity: 'low',
            category: 'process',
            text: 'No ADR for this change.\n\n- see CLAUDE.md',
            status: 'open',
            reason: '',
            round: 0,
          },
        ],
      }),
      role: role(),
      units: [unit()],
      rules: [],
    })
    expect(text).toContain('## Notes from review')
    expect(text).toContain('RT-1')
    expect(text).toContain('No ADR for this change.')
    expect(text).not.toContain('see CLAUDE.md')
  })
}

function briefBlockingFindingsTests() {
  it('says nothing about a blocking finding — that never reaches a builder', () => {
    const text = brief({
      order: order({
        redTeam: [
          {
            id: 'RT-1',
            severity: 'high',
            category: 'wrong-outcome',
            text: 'The outcome is not actually satisfied.',
            status: 'open',
            reason: '',
            round: 0,
          },
        ],
      }),
      role: role(),
      units: [unit()],
      rules: [],
    })
    expect(text).not.toContain('## Notes from review')
  })
}

function briefLanesTests() {
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
}

function verifiersAndSilentRolesTests() {
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
}

const documentVerifier = role({
  id: 'verifier',
  reads: ['unit_diff', 'criteria', 'toolchain', 'rules'],
  writes: [],
})

function withDocument(document: WorkOrder['document'], who: Role = documentVerifier): string {
  return brief({ order: order({ document }), role: who, units: [], rules: [] })
}

describe('a verifier is told where the document under review is', verifierDocumentTests)

function verifierDocumentTests() {
  it('names the path of a document filed in outputs', () => {
    const text = withDocument({ path: '/out/WO-1/research.md', location: 'outputs' })
    expect(text).toContain('The document under review is /out/WO-1/research.md.')
    expect(text).toContain('the change in the checkout may be empty')
    expect(text).not.toContain('published at')
  })

  it('names the path and the url of a published document', () => {
    const text = withDocument({
      path: '/out/WO-1/research.md',
      url: 'https://docs.example/research',
      location: 'published',
    })
    expect(text).toContain('The document under review is /out/WO-1/research.md.')
    expect(text).toContain(
      'It was published at https://docs.example/research; the file above is the copy that was published.'
    )
  })
}

describe('a verifier is told nothing when there is nothing to find', noDocumentTests)

function noDocumentTests() {
  it('adds nothing for a document in the checkout, which the diff already shows', () => {
    const text = withDocument({ path: 'docs/research.md', location: 'checkout' })
    expect(text).not.toContain('The document under review')
  })

  it('adds nothing for a role that does not read the diff', () => {
    const author = role({ id: 'author', reads: ['unit', 'context'] })
    const text = withDocument({ path: '/out/WO-1/research.md', location: 'outputs' }, author)
    expect(text).not.toContain('The document under review')
  })
}

function feedback(over: Partial<Feedback> = {}): Feedback {
  return {
    from: 'run:test',
    attempt: 1,
    source: 'check',
    command: 'npm test',
    exitCode: 1,
    excerpt: 'AssertionError: expected 200 to be 401',
    logPath: '/logs/run.log',
    ...over,
  }
}

describe('a builder sent back is told why', () => {
  describe('the failed check', theFailedCheckTests)
  describe('unknown and empty feedback', unknownAndEmptyFeedbackTests)
  describe('who reads it and where', whoReadsItAndWhereTests)
})

function theFailedCheckTests() {
  it('names the failed check, its exit status and the excerpt', () => {
    const text = brief({
      order: order(),
      role: role(),
      units: [unit()],
      rules: [],
      feedback: [feedback()],
    })
    expect(text).toContain('## Your previous attempt failed a check')
    expect(text).toContain('Fix its cause, not the check.')
    expect(text).toContain('`npm test`')
    expect(text).toContain('exit 1')
    expect(text).toContain('AssertionError: expected 200 to be 401')
  })

  it('renders every entry, most recent last, in order', () => {
    const text = brief({
      order: order(),
      role: role(),
      units: [unit()],
      rules: [],
      feedback: [
        feedback({ attempt: 1, command: 'npm test', excerpt: 'first failure' }),
        feedback({ attempt: 2, command: 'npm run lint', excerpt: 'second failure' }),
      ],
    })
    expect(text.indexOf('first failure')).toBeLessThan(text.indexOf('second failure'))
    expect(text).toContain('`npm run lint`')
  })
}

function unknownAndEmptyFeedbackTests() {
  it('says so when the command is unknown', () => {
    const text = brief({
      order: order(),
      role: role(),
      units: [unit()],
      rules: [],
      feedback: [feedback({ command: null, exitCode: null })],
    })
    expect(text).toContain('a check')
    expect(text).toContain('no exit status')
  })

  it('renders nothing for an empty feedback list', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [], feedback: [] })
    expect(text).not.toContain('failed a check')
  })

  it('renders nothing when feedback is absent', () => {
    const text = brief({ order: order(), role: role(), units: [unit()], rules: [] })
    expect(text).not.toContain('failed a check')
  })
}

function whoReadsItAndWhereTests() {
  it('renders nothing for a role that does not read feedback', () => {
    const verifier = role({ id: 'verifier', reads: ['criteria'], writes: [], allowResume: false })
    const text = brief({
      order: order(),
      role: verifier,
      units: [unit()],
      rules: [],
      feedback: [feedback()],
    })
    expect(text).not.toContain('failed a check')
  })

  it('sits right after the unit section and before the repository', () => {
    const text = brief({
      order: order(),
      role: role(),
      units: [unit()],
      rules: [],
      feedback: [feedback()],
    })
    expect(text.indexOf('## The unit:')).toBeLessThan(text.indexOf('failed a check'))
    expect(text.indexOf('failed a check')).toBeLessThan(text.indexOf('## The repository'))
  })
}

describe('the repository, for a role that reads it', () => {
  describe('the commands', theCommandsTests)
  describe('no commands and the project notes', noCommandsAndTheProjectNotesTests)
  describe('earlier decisions', earlierDecisionsTests)
  describe('assumptions', assumptionsTests)
  describe('struck assumptions', briefStruckAssumptionsTests)
})

function theCommandsTests() {
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
}

function noCommandsAndTheProjectNotesTests() {
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
}

function earlierDecisionsTests() {
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
}

function assumptionsTests() {
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
}

function briefStruckAssumptionsTests() {
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
}

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
  describe('read-only roles', readOnlyRolesTests)
  describe('authors', authorsTests)
  describe('roles with no document', rolesWithNoDocumentTests)
  describe('its place in the brief', itsPlaceInTheBriefTests)
})

function readOnlyRolesTests() {
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
}

function authorsTests() {
  it('gives an author the outputs directory beside the file to hand back', () => {
    const text = brief({
      order: order(),
      role: role({ id: 'author', writes: ['docs', 'document'], reads: ['order'], tools: ['edit'] }),
      units: [],
      rules: [],
      outputPath: '/data/orders/WO-1/rungs/write.json',
      outputsDir: '/data/orders/WO-1/outputs',
    })
    expect(text).toContain('/data/orders/WO-1/outputs')
    expect(text).toContain('"location"')
  })

  it('names no outputs directory to a role that hands back no document', () => {
    const text = brief({
      order: order(),
      role: role({ id: 'scout', writes: ['context'], tools: ['read'] }),
      units: [],
      rules: [],
      outputPath: '/rungs/scout.json',
      outputsDir: '/data/orders/WO-1/outputs',
    })
    expect(text).not.toContain('/data/orders/WO-1/outputs')
  })
}

function rolesWithNoDocumentTests() {
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
}

function itsPlaceInTheBriefTests() {
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
}

describe('a document that changes the interface is told to draw it', () => {
  const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const sources = { dataRoot: path.join(builtInDir, 'no-data-root'), repoPaths: [], builtInDir }
  const { rules, problems } = rulesFor(sources, { repoPaths: [], houseDocs: [] })

  it('loads the renderings rule without problems', () => {
    expect(problems).toEqual([])
    expect(rules.map((r) => r.id)).toContain('ui-change-renderings')
  })

  it.each(['author', 'architect', 'scribe'])('puts the rule in the %s brief', (id) => {
    const real = createRoleRegistry(sources).get(id)
    const text = brief({ order: order(), role: real, units: [], rules })
    expect(text).toContain('ui-change-renderings')
  })
})
