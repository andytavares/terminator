import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The agreed order the live specs hand to Foundry: one unit on one lane of the
// scratch repository, changing src/session.js and its test. The Forge is what
// writes one normally and has its own cover; what is under test in these specs
// is an agent doing the work it describes.

/** What one live spec's order says, beside what every one of them shares. */
export interface LiveOrder {
  repo: string
  id: string
  title: string
  problem: string
  outcome: string
  /** The acceptance criterion's statement. */
  statement: string
  /** The one unit's title. */
  unitTitle: string
  lintCommand: string
  wallClockMinutes: number
  /** When it was agreed; the moment it is written, if left out. */
  agreedAt?: string
}

function liveContext({ repo, lintCommand }: LiveOrder): unknown {
  return {
    repos: [{ name: 'live', path: repo, lane: 1, baseBranch: 'main', headBranch: '' }],
    toolchain: {
      test: { command: 'npm test', source: 'package.json' },
      lint: { command: lintCommand, source: 'package.json' },
      format: null,
      coverage: null,
      e2e: null,
      build: null,
    },
    entryPoints: ['src/session.js'],
    priorArt: [],
    conventions: [],
    houseDocs: [],
  }
}

function livePlan({ unitTitle }: LiveOrder): unknown {
  return {
    units: [
      {
        id: 'U-1',
        title: unitTitle,
        role: 'builder',
        lane: 1,
        dependsOn: [],
        satisfies: ['AC-1'],
        touches: ['src/session.js', 'src/session.test.js'],
        verify: [],
      },
    ],
    lanes: [{ ord: 1, repo: 'live', branch: '', role: null, blocks: [], blockedBy: [] }],
    sharedFiles: [],
  }
}

function liveAcceptance({ statement }: LiveOrder): unknown[] {
  return [
    {
      id: 'AC-1',
      statement,
      priority: 'P1',
      verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
      unverifiable: null,
    },
  ]
}

/**
 * The test file as well as the source. The builder's role tells it to write
 * the failing test first, so a unit that changes code in a tested repository
 * touches two files — and one it writes that the order did not declare is a
 * risk trigger. A live run was held for an operator on `outside_blast_radius`
 * for exactly this, which was the order being wrong rather than the run.
 */
const LIVE_RISK = {
  grade: 'P2',
  triggers: [],
  blastRadius: ['src/session.js', 'src/session.test.js'],
  criticalPaths: [],
}

function liveOrderJson(order: LiveOrder): unknown {
  return {
    schemaVersion: 1,
    id: order.id,
    title: order.title,
    status: 'agreed',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    writeBack: [],
    stateMapping: { started: null, in_review: null, done: null },
    recipe: 'direct',
    recipeOverriddenBy: 'operator',
    intent: {
      problem: order.problem,
      outcome: order.outcome,
      nonGoals: ['Changing how expiry is computed'],
    },
    context: liveContext(order),
    acceptance: liveAcceptance(order),
    risk: LIVE_RISK,
    // Room for the whole pipeline plus the climb. At twenty minutes the budget
    // was the thing under test: four agents and eight rungs is fifteen minutes
    // on a good run, so a slow builder gated it rather than shipping. That the
    // budget gate fires correctly is proven — a live run raised it, halted,
    // left its agents in their terminals and wrote "not every node finished" —
    // and it is not what these tests are named after.
    budgets: { agents: 1, wallClockMinutes: order.wallClockMinutes, tokens: null },
    plan: livePlan(order),
    assumptions: [],
    openQuestions: [],
    redTeam: [],
    provenance: { forgeSession: null, decisions: [], amendments: [] },
    createdAt: new Date().toISOString(),
    agreedAt: order.agreedAt ?? new Date().toISOString(),
  }
}

/** Writes the order where Foundry keeps its records, in the scratch repository. */
export function writeLiveOrder(order: LiveOrder): void {
  const dir = join(order.repo, '.foundry', 'orders', order.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'order.json'), JSON.stringify(liveOrderJson(order), null, 2))
}
