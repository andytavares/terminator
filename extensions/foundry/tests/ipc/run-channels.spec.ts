import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { queueEntry } from '../helpers/queue-entries.js'
import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunChannels, proposeRecipe, readRunGraph } from '../../src/ipc/run-channels.js'
import type { RunDeps } from '../../src/ipc/run-channels.js'
import { idleRunSeams } from './run-deps.js'
import { createOrderStore } from '../../src/order/store.js'
import type { OrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import { probeToolchain } from '../../src/verify/toolchain-probe.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import type { ToolActivity } from '../../src/runtime/transcript-tailer.js'
import { readTimeline } from '../../src/factory/timeline-store.js'
import { writeCiState } from '../../src/line/ci-state.js'
import type { CiState } from '../../src/line/ci-state.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

// Everything that can refuse a run refuses before any work begins. An order
// that fails half way through because a recipe could not run here has already
// spent agent time on a shape that was never going to finish.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let dataRoot: string
let repo: string
let store: OrderStore

function runDeps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    store,
    // Resolved on every call in the host, because the records location follows
    // the open workspace — a fixed value here is what that resolver returns.
    dataRoot: () => dataRoot,
    sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
    now: () => '2026-09-06T10:00:00.000Z',
    ...idleRunSeams(),
    ...over,
  }
}

function freshRunChannels() {
  return createRunChannels(runDeps())
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'agreed',
    acceptance: [testCriterion('AC-1', { statement: 'a' })],
    plan: {
      ...base.plan,
      units: [builderUnit('U-1', { title: 'a', satisfies: ['AC-1'], touches: ['src/a'] })],
    },
    ...over,
  }
}

beforeEach(() => {
  dataRoot = makeTempDir('fdry-run-')
  repo = makeTempDir('fdry-run-repo-')
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
  store = createOrderStore(dataRoot)
})

afterEach(() => {
  for (const dir of [dataRoot, repo]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('foundry:run.start', () => {
  describe('building', buildingTests)
  describe('unknown skills', unknownSkillsTests)
  describe('shapes', shapesTests)
  describe('recording', runChannelsRecordingTests)
  describe('unknown recipes and orders', unknownRecipesAndOrdersTests)
})

function buildingTests() {
  it('builds a graph and moves the order to running', async () => {
    await store.save(order())
    const r = (await freshRunChannels().start({ id: 'WO-1' })) as {
      graph: RunGraph
      order: WorkOrder
    }
    expect(r.graph.nodes.length).toBeGreaterThan(0)
    expect(r.order.status).toBe('running')
    expect((await store.load('WO-1'))?.status).toBe('running')
  })

  it('persists the graph so a restart can pick it up', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    expect(fs.existsSync(path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json'))).toBe(true)
  })

  it('refuses an order that has not been agreed, without building anything', async () => {
    await store.save(order({ status: 'draft' }))
    const r = (await freshRunChannels().start({ id: 'WO-1' })) as { error: string }
    expect(r.error).toMatch(/Only an agreed order/)
    expect(fs.existsSync(path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json'))).toBe(false)
  })
}

function unknownSkillsTests() {
  it('refuses to start when a role names a skill nothing defines, and nothing runs', async () => {
    // The data root overrides the built-in builder with one that names a
    // skill nobody has, at any of the three rungs.
    fs.mkdirSync(path.join(dataRoot, 'roles'), { recursive: true })
    fs.writeFileSync(
      path.join(dataRoot, 'roles', 'builder.yaml'),
      [
        'schemaVersion: 1',
        'id: builder',
        'modelTier: deep',
        'allowResume: true',
        'reads: []',
        'writes: [worktree]',
        'tools: []',
        'skills: [nonexistent]',
        'prompt: build it',
        '',
      ].join('\n')
    )
    await store.save(order())
    const r = (await freshRunChannels().start({ id: 'WO-1' })) as { error: string }
    expect(r.error).toMatch(/Unknown skill "nonexistent"/)
    expect(r.error).toContain('builder')
    expect(r.error).toContain(`${dataRoot}/skills/nonexistent/SKILL.md`)
    expect(fs.existsSync(path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json'))).toBe(false)
    expect((await store.load('WO-1'))?.status).toBe('agreed')
  })
}

function shapesTests() {
  it('refuses a shape this repository cannot support, and says why', async () => {
    await store.save(order())
    const r = (await freshRunChannels().start({ id: 'WO-1', recipe: 'speckit' })) as {
      error: string
    }
    expect(r.error).toMatch(/cannot run here/)
    expect(r.error).toMatch(/\.specify/)
  })

  it('runs that same shape once the repository supports it', async () => {
    fs.mkdirSync(path.join(repo, '.specify'), { recursive: true })
    await store.save(order())
    const r = (await freshRunChannels().start({ id: 'WO-1', recipe: 'speckit' })) as {
      graph: RunGraph
    }
    expect(r.graph.recipe).toBe('speckit')
  })
}

function runChannelsRecordingTests() {
  it('records an operator override as an operator decision', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1', recipe: 'direct' })
    const saved = await store.load('WO-1')
    expect(saved?.recipeOverriddenBy).toBe('operator')
    const ledger = fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('"actor":"operator"')
  })

  it('records a proposal as the architect proposing, not the operator choosing', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    expect((await store.load('WO-1'))?.recipeOverriddenBy).toBeNull()
    const ledger = fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('role:architect')
  })

  it('records which rung the recipe came from', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    expect(
      fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
    ).toContain('built-in')
  })
}

function unknownRecipesAndOrdersTests() {
  it('reports a recipe nobody defines', async () => {
    await store.save(order())
    const r = (await freshRunChannels().start({ id: 'WO-1', recipe: 'nonesuch' })) as {
      error: string
    }
    expect(r.error).toMatch(/nonesuch/)
  })

  it('reports an order it cannot find', async () => {
    expect(await freshRunChannels().start({ id: 'WO-nope' })).toEqual({
      error: 'No order WO-nope.',
    })
  })
}

describe('foundry:run.observe', () => {
  describe('the graph', runChannelsTheGraphTests)
  describe('CI', runChannelsCiTests)
  describe('pull requests', pullRequestsTests)
  describe('no pulls and the ticket', noPullsAndTheTicketTests)
  describe('the document handed back', documentOnTheFloorTests)
  describe('no CI and skills', noCiAndSkillsTests)
  describe('unresolved skills and no queue', unresolvedSkillsAndNoQueueTests)
  describe('the queue position', runChannelsTheQueuePositionTests)
})

function runChannelsTheGraphTests() {
  it('reports the graph, what can start and what is waiting', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as {
      graph: RunGraph
      ready: string[]
      blocked: { id: string; reason: string }[]
    }
    expect(r.ready.length).toBeGreaterThan(0)
    expect(r.blocked.some((b) => b.reason.startsWith('waiting on'))).toBe(true)
  })

  it('reports no run before one has started', async () => {
    await store.save(order())
    expect(await freshRunChannels().observe({ id: 'WO-1' })).toEqual({ error: 'No run for WO-1.' })
  })
}

function runChannelsCiTests() {
  it('reports the CI state a written ci.json carries', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const state: CiState = {
      round: 1,
      max: 3,
      status: 'watching',
      pulls: [{ url: 'https://github.com/x/y/pull/1', checks: [] }],
      reason: '',
      at: '2026-09-06T10:00:00.000Z',
    }
    await writeCiState(dataRoot, 'WO-1', state)
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as { ci: CiState | null }
    expect(r.ci).toEqual(state)
  })
}

function pullRequestsTests() {
  it('reports each pull request the run opened, with its address', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    fs.writeFileSync(
      path.join(dataRoot, 'orders', 'WO-1', 'pulls.json'),
      JSON.stringify([
        {
          lane: 1,
          repo: 'proto',
          cwd: '/work/proto',
          branch: 'foundry/wo-1',
          url: 'https://github.com/x/proto/pull/233',
          bodyPath: '/tmp/body.md',
        },
      ])
    )
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as {
      pulls: { repo: string; url: string; number: number; cwd: string }[]
    }
    expect(r.pulls).toEqual([
      {
        repo: 'proto',
        url: 'https://github.com/x/proto/pull/233',
        number: 233,
        cwd: '/work/proto',
      },
    ])
  })
}

function noPullsAndTheTicketTests() {
  it('reports no pull requests before one is opened', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as { pulls: unknown[] }
    expect(r.pulls).toEqual([])
  })

  it('reports the ticket the order came from, and null for a typed idea', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const typed = (await freshRunChannels().observe({ id: 'WO-1' })) as { source: unknown }
    expect(typed.source).toBeNull()

    const running = (await store.load('WO-1')) as WorkOrder
    await store.save({
      ...running,
      source: {
        kind: 'tracker',
        tracker: 'linear',
        key: 'TAV-15',
        url: 'https://linear.app/t/issue/TAV-15',
      },
    })
    const ticket = (await freshRunChannels().observe({ id: 'WO-1' })) as { source: unknown }
    expect(ticket.source).toEqual({ key: 'TAV-15', url: 'https://linear.app/t/issue/TAV-15' })
  })
}

function noCiAndSkillsTests() {
  it('reports no CI when nothing has written one', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as { ci: CiState | null }
    expect(r.ci).toBeNull()
  })

  it("reports each node's skills, resolved from the order's recipe", async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const graph = await readRunGraph(dataRoot, 'WO-1')
    const builderNode = graph?.nodes.find((n) => n.role === 'builder')
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as {
      skills: Record<string, string[]>
    }
    expect(builderNode).toBeDefined()
    expect(r.skills[builderNode?.id ?? '']).toEqual(['ci-fix'])
  })
}

function unresolvedSkillsAndNoQueueTests() {
  it('reports no skills for an order whose recipe no longer resolves', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const running = await store.load('WO-1')
    await store.save({ ...(running as WorkOrder), recipe: 'ghost-recipe' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as {
      skills: Record<string, string[]>
    }
    expect(r.skills).toEqual({})
  })

  it('carries no queue when nothing has wired the refinery', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as { queue: unknown }
    expect(r.queue).toBeNull()
  })
}

function runChannelsTheQueuePositionTests() {
  it('carries the queue position when the refinery is wired and this order overlaps another', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const withQueue = createRunChannels(
      runDeps({
        queueEntries: async () => [
          queueEntry('WO-1', {
            title: 'x',
            agreedAt: '2026-09-02T00:00:00.000Z',
            files: ['src/a'],
          }),
          queueEntry('WO-earlier', { title: 'Earlier work', files: ['src/a'] }),
        ],
      })
    )
    const r = (await withQueue.observe({ id: 'WO-1' })) as {
      queue: { position: number; behind: { orderId: string }[] } | null
    }
    expect(r.queue?.position).toBe(2)
    expect(r.queue?.behind[0]?.orderId).toBe('WO-earlier')
  })
}

describe('foundry:run.recipes', () => {
  describe('offering', offeringTests)
  describe('the choice', theChoiceTests)
  describe('the proposal', runChannelsTheProposalTests)
})

function unit(over: Partial<WorkOrder['plan']['units'][number]> = {}) {
  return {
    id: 'U-2',
    title: 'b',
    role: 'builder',
    lane: 1,
    dependsOn: [],
    satisfies: ['AC-1'],
    touches: [],
    verify: [],
    ...over,
  }
}
function graded(grade: WorkOrder['risk']['grade'], triggers: WorkOrder['risk']['triggers'] = []) {
  return order({ risk: { grade, triggers, blastRadius: [], criticalPaths: [] } })
}

function offeringTests() {
  it('offers every shape, marking the ones this repository cannot support', async () => {
    await store.save(order())
    const r = (await freshRunChannels().recipes({ id: 'WO-1' })) as {
      recipes: { name: string; available: boolean; unmet: string[] }[]
      proposed: string
    }
    const speckit = r.recipes.find((x) => x.name === 'speckit')
    expect(speckit?.available).toBe(false)
    expect(speckit?.unmet[0]).toMatch(/\.specify/)
    expect(r.recipes.find((x) => x.name === 'direct')?.available).toBe(true)
  })

  it('names which rung each shape came from', async () => {
    await store.save(order())
    const r = (await freshRunChannels().recipes({ id: 'WO-1' })) as { recipes: { rung: string }[] }
    expect(r.recipes.every((x) => x.rung === 'built-in')).toBe(true)
  })
}

function theChoiceTests() {
  it('is unchosen, with no chosenAt, before the operator picks one', async () => {
    await store.save(order())
    const r = (await freshRunChannels().recipes({ id: 'WO-1' })) as {
      chosen: string | null
      chosenAt: string | null
    }
    expect(r.chosen).toBeNull()
    expect(r.chosenAt).toBeNull()
  })

  it('reports what the operator chose and when', async () => {
    await store.save(order())
    await store.record({
      at: '2026-09-06T10:05:00.000Z',
      orderId: 'WO-1',
      actor: 'operator',
      action: 'recipe.chosen',
      subject: 'WO-1',
      reason: 'standard',
      evidence: [],
    })
    await store.save({ ...order(), recipe: 'standard' })
    const r = (await freshRunChannels().recipes({ id: 'WO-1' })) as {
      chosen: string | null
      chosenAt: string | null
    }
    expect(r.chosen).toBe('standard')
    expect(r.chosenAt).toBe('2026-09-06T10:05:00.000Z')
  })
}

function runChannelsTheProposalTests() {
  // The ladder's own proposal ignores the operator's pick — overriding one
  // recipe with another must not read back as "the ladder proposed this".
  it('proposes what the ladder would choose, ignoring the operator’s own pick', async () => {
    await store.save({ ...order(), recipe: 'standard' })
    const r = (await freshRunChannels().recipes({ id: 'WO-1' })) as { proposed: string }
    expect(r.proposed).toBe('direct')
  })
}

// Choosing the shape.
//
// The ladder is lanes first, then risk. Lanes because that is the only thing a
// heavier shape can actually run in parallel, and risk because that is the
// order's own statement of who ought to look. Unit count decides nothing: a
// fan-out is `by lane` now, so seven units in one lane cost one session and
// pricing the shape off them charged for parallelism that never existed.
describe('proposeRecipe', () => {
  describe('direct', directTests)
  describe('standard', standardTests)
})

function directTests() {
  it('keeps a shape the order already carries', () => {
    expect(proposeRecipe(order({ recipe: 'bugfix' }))).toEqual({
      name: 'bugfix',
      why: 'the order already names this shape',
    })
  })

  it('proposes the direct shape for one lane at the lowest risk', () => {
    const proposal = proposeRecipe(graded('P3'))
    expect(proposal.name).toBe('direct')
    expect(proposal.why).toBe('one lane, graded low risk')
  })

  it('still proposes it when that lane holds several units', () => {
    const o = graded('P3')
    o.plan.units.push(unit(), unit({ id: 'U-3' }), unit({ id: 'U-4' }))
    expect(proposeRecipe(o).name).toBe('direct')
  })

  it('proposes direct for an order graded notable', () => {
    const proposal = proposeRecipe(graded('P2'))
    expect(proposal.name).toBe('direct')
    expect(proposal.why).toContain('ordinary risk')
  })

  it('proposes direct, naming the trigger, when one fired at the lowest grade', () => {
    const proposal = proposeRecipe(graded('P3', ['public_interface']))
    expect(proposal.name).toBe('direct')
    expect(proposal.why).toContain('public_interface')
  })
}

function standardTests() {
  it('proposes the standard shape once there is more than one lane', () => {
    const o = graded('P3')
    o.plan.units.push(unit({ lane: 2 }))
    o.plan.lanes = [
      { ord: 1, repo: 'a', branch: '', role: null, blocks: [], blockedBy: [] },
      { ord: 2, repo: 'b', branch: '', role: null, blocks: [], blockedBy: [] },
    ]
    const proposal = proposeRecipe(o)
    expect(proposal.name).toBe('standard')
    expect(proposal.why).toBe('2 lanes of work')
  })

  it('proposes the standard shape for anything above the lowest two grades', () => {
    const proposal = proposeRecipe(graded('P1'))
    expect(proposal.name).toBe('standard')
    expect(proposal.why).toContain("above the direct shape's ceiling")
  })
}

describe('the reason a shape was chosen (FR-014)', () => {
  describe('recording the reason', recordingTheReasonTests)
  describe('offering the reason', offeringTheReasonTests)
  describe('direct and refused choices', directAndRefusedChoicesTests)
})

function recordingTheReasonTests() {
  function ledgerText(): string {
    return fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
  }

  it('records why the system picked the shape, not only where it came from', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const text = ledgerText()
    expect(text).toContain('role:architect')
    expect(text).toContain('one lane, graded low risk')
    expect(text).toContain('resolved from built-in')
  })

  it('says the operator chose it when the operator chose it', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1', recipe: 'standard' })
    expect(ledgerText()).toContain('chosen by the operator')
  })
}

function offeringTheReasonTests() {
  it('offers the reason alongside the proposal', async () => {
    await store.save(order())
    const view = (await freshRunChannels().recipes({ id: 'WO-1' })) as {
      proposed: string
      proposedWhy: string
    }
    expect(view.proposed).toBe('direct')
    expect(view.proposedWhy).toBe('one lane, graded low risk')
  })

  it('proposes direct in a repository with no test command, because direct needs none', async () => {
    await store.save(order())
    const view = (await freshRunChannels().recipes({ id: 'WO-1' })) as {
      recipes: { name: string; available: boolean }[]
      proposed: string
    }
    expect(view.recipes.find((r) => r.name === 'direct')?.available).toBe(true)
    expect(view.proposed).toBe('direct')
  })
}

function directAndRefusedChoicesTests() {
  it('proposes direct where a test command exists too', async () => {
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } })
    )
    const o = order()
    await store.save({
      ...o,
      context: { ...o.context, toolchain: probeToolchain(repo) },
    })
    const view = (await freshRunChannels().recipes({ id: 'WO-1' })) as { proposed: string }
    expect(view.proposed).toBe('direct')
  })

  // Never quietly swapped: an operator who names a shape gets it or gets told
  // why not, because a silent substitution is a decision nobody made.
  it('refuses an operator choice this repository cannot run, rather than stepping down', async () => {
    await store.save(order())
    const result = (await freshRunChannels().start({ id: 'WO-1', recipe: 'speckit' })) as {
      error?: string
    }
    expect(result.error).toContain('speckit')
    expect(result.error).toContain('.specify')
  })
}

// A run left in flight when the application closed is picked back up by
// reading its graph off disk (042). Graphs written before a fan-out node could
// carry a whole lane have `unitId`, a single value, and nothing validates the
// file on the way in — so the boundary that reads it is the one place worth
// converting.
/** What every node in an old graph carries besides what each test names. */
const LEGACY_NODE = {
  lane: null,
  role: null,
  dependsOn: [],
  attempts: 0,
  sessionId: null,
  worktreePath: null,
  startedAt: null,
  endedAt: null,
}

/** Writes WO-1's graph the way an earlier build did, with this one node. */
function writeLegacyGraph(node: Record<string, unknown>): void {
  const dir = path.join(dataRoot, 'orders', 'WO-1')
  fs.mkdirSync(dir, { recursive: true })
  const graph = { orderId: 'WO-1', recipe: 'direct', nodes: [{ ...LEGACY_NODE, ...node }] }
  fs.writeFileSync(path.join(dir, 'run-graph.json'), JSON.stringify(graph))
}

describe('a graph written before a node could carry a lane', () => {
  it('reads a legacy unitId as the one unit it names', async () => {
    writeLegacyGraph({
      id: 'build:U-1',
      stepId: 'build',
      kind: 'fanout',
      state: 'running',
      unitId: 'U-1',
      lane: 1,
      role: 'builder',
      attempts: 1,
      sessionId: 's-1',
    })
    const graph = await readRunGraph(dataRoot, 'WO-1')
    expect(graph?.nodes[0].unitIds).toEqual(['U-1'])
  })

  it('reads a legacy node with no unit as covering none', async () => {
    writeLegacyGraph({ id: 'ship', stepId: 'ship', kind: 'gate', state: 'waiting', unitId: null })
    const graph = await readRunGraph(dataRoot, 'WO-1')
    expect(graph?.nodes[0].unitIds).toEqual([])
  })

  it('reads a graph written before reworks and feedback existed as having neither', async () => {
    writeLegacyGraph({ id: 'lint', stepId: 'lint', kind: 'agent', state: 'waiting', unitIds: [] })
    const graph = await readRunGraph(dataRoot, 'WO-1')
    expect(graph?.nodes[0].reworks).toBe(0)
    expect(graph?.nodes[0].feedback).toEqual([])
  })
})

/** Starts WO-1 with its records in a directory nobody may write to, then cleans up. */
async function startWhereNothingCanBeWritten(): Promise<{ error: string }> {
  const wall = makeTempDir('fdry-wall-')
  fs.chmodSync(wall, 0o500)
  try {
    const blocked = createRunChannels(runDeps({ dataRoot: () => path.join(wall, 'foundry') }))
    return (await blocked.start({ id: 'WO-1' })) as { error: string }
  } finally {
    fs.chmodSync(wall, 0o700)
    fs.rmSync(wall, { recursive: true, force: true })
  }
}

describe('the records location', () => {
  it('refuses to start when the records location cannot be written to, before any work begins', async () => {
    await store.save(order())
    const r = await startWhereNothingCanBeWritten()

    expect(r.error).toContain('foundry')
    // And the order is untouched — no half-started run.
    expect((await store.load('WO-1'))?.status).toBe('agreed')
  })
})

function setNode(over: Record<string, unknown>): string {
  const graphPath = path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json')
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as {
    nodes: Record<string, unknown>[]
  }
  Object.assign(graph.nodes[0], over)
  fs.writeFileSync(graphPath, JSON.stringify(graph))
  return graph.nodes[0].id as string
}
async function startedRun(): Promise<void> {
  await store.save(order())
  await freshRunChannels().start({ id: 'WO-1' })
}

describe('attaching to a running agent', () => {
  describe('the live session', theLiveSessionTests)
  describe('no session yet', noSessionYetTests)

  describe('what it says about a step that has no agent to go to', () => {
    describe('finished and automatic steps', finishedAndAutomaticStepsTests)
    describe('the resume wording', theResumeWordingTests)
  })

  it('reports a node that is not in the run', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().attach({ orderId: 'WO-1', nodeId: 'nope' })) as {
      error: string
    }
    expect(r.error).toBe('No step nope.')
  })

  it('reports an order with no run', async () => {
    const r = (await freshRunChannels().attach({ orderId: 'WO-nope', nodeId: 'x' })) as {
      error: string
    }
    expect(r.error).toBe('No run for WO-nope.')
  })
})

function theLiveSessionTests() {
  it('returns the live session behind a node', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    // The scheduler stamps a session when it starts a node; simulate that.
    const graphPath = path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json')
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as {
      nodes: { id: string; sessionId: string | null }[]
    }
    graph.nodes[0].sessionId = 'sess-42'
    fs.writeFileSync(graphPath, JSON.stringify(graph))

    // Live, said out loud. A session id outlives the process that ran it, so
    // "there is an id on the node" is not the same question as "is anything
    // running it" — and only the second one can be attached to.
    const withRunner = createRunChannels(
      runDeps({
        isLive: (sessionId) => sessionId === 'sess-42',
      })
    )
    const r = (await withRunner.attach({ orderId: 'WO-1', nodeId: graph.nodes[0].id })) as {
      terminalSessionId: string
    }
    expect(r.terminalSessionId).toBe('sess-42')
  })
}

function noSessionYetTests() {
  it('says why rather than pretending, when a node has no session yet', async () => {
    await store.save(order())
    const started = (await freshRunChannels().start({ id: 'WO-1' })) as {
      graph: { nodes: { id: string }[] }
    }
    const r = (await freshRunChannels().attach({
      orderId: 'WO-1',
      nodeId: started.graph.nodes[0].id,
    })) as { error: string }
    expect(r.error).toMatch(/no session yet/)
  })
}

function channelsWithActivity(activityFor: (sessionId: string) => ToolActivity[]) {
  return createRunChannels(
    runDeps({
      activityFor,
    })
  )
}
async function startedGraph(): Promise<readonly { id: string; sessionId: string | null }[]> {
  await store.save(order())
  const r = (await freshRunChannels().start({ id: 'WO-1' })) as { graph: RunGraph }
  return r.graph.nodes
}
function activityEvent(at: number, callId = `c-${at}`): ToolActivity {
  return { kind: 'tool_started', toolName: 'Read', callId, isShell: false, path: null, at }
}

function finishedAndAutomaticStepsTests() {
  it.each(['passed', 'failed', 'skipped'])(
    'says a %s step finished, and when, instead of blaming a restart',
    async (state) => {
      await startedRun()
      const id = setNode({ state, sessionId: 'sess-9', endedAt: '2026-09-06T09:41:00.000Z' })
      const r = (await freshRunChannels().attach({ orderId: 'WO-1', nodeId: id })) as {
        error: string
      }
      expect(r.error).toMatch(/ finished at \d\d:\d\d; its agent has closed\.$/)
      expect(r.error).not.toContain('Resume the run')
    }
  )

  it.each(['gate', 'join'])('says a %s step is automatic and has no agent', async (kind) => {
    await startedRun()
    const id = setNode({ kind, state: 'passed', sessionId: null })
    const r = (await freshRunChannels().attach({ orderId: 'WO-1', nodeId: id })) as {
      error: string
    }
    expect(r.error).toMatch(/ is an automatic step with no agent\.$/)
  })
}

function theResumeWordingTests() {
  it('keeps the resume wording for a running step whose session is not live', async () => {
    await startedRun()
    const id = setNode({ state: 'running', sessionId: 'sess-9' })
    const r = (await freshRunChannels().attach({ orderId: 'WO-1', nodeId: id })) as {
      error: string
    }
    expect(r.error).toContain('Resume the run to start it again.')
  })
}

describe('foundry:run.activity', () => {
  describe('the last entries', theLastEntriesTests)
  describe('no session and no run', noSessionAndNoRunTests)
})

function theLastEntriesTests() {
  it('returns the last 20 activity entries for a node with a session', async () => {
    const nodes = await startedGraph()
    const graphPath = path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json')
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as {
      nodes: { id: string; sessionId: string | null }[]
    }
    graph.nodes[0].sessionId = 'sess-1'
    fs.writeFileSync(graphPath, JSON.stringify(graph))

    const events = Array.from({ length: 25 }, (_, i) => activityEvent(i))
    const withActivity = channelsWithActivity((sessionId) => (sessionId === 'sess-1' ? events : []))
    const r = (await withActivity.activity({ id: 'WO-1' })) as {
      activity: Record<string, ToolActivity[]>
    }
    expect(r.activity[nodes[0].id]).toHaveLength(20)
    expect(r.activity[nodes[0].id]).toEqual(events.slice(-20))
  })
}

function noSessionAndNoRunTests() {
  it('omits nodes with no session', async () => {
    const nodes = await startedGraph()
    const withActivity = channelsWithActivity(() => [activityEvent(1)])
    const r = (await withActivity.activity({ id: 'WO-1' })) as {
      activity: Record<string, ToolActivity[]>
    }
    expect(Object.keys(r.activity)).not.toContain(nodes[0].id)
  })

  it('reports an order with no run', async () => {
    const r = (await freshRunChannels().activity({ id: 'WO-nope' })) as { error: string }
    expect(r.error).toBe('No run for WO-nope.')
  })
}

describe('offering shapes of work', () => {
  it('reports an order it cannot find', async () => {
    expect(await freshRunChannels().recipes({ id: 'WO-nope' })).toEqual({
      error: 'No order WO-nope.',
    })
  })

  it('marks a malformed operator recipe as unavailable rather than hiding it', async () => {
    await store.save(order())
    fs.mkdirSync(path.join(dataRoot, 'recipes'), { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'recipes', 'broken.yaml'), 'id: [unclosed\n')
    const r = (await freshRunChannels().recipes({ id: 'WO-1' })) as {
      recipes: { name: string; available: boolean }[]
    }
    expect(r.recipes.find((x) => x.name === 'broken')?.available).toBe(false)
  })

  it('observes with the order own budgets rather than a guessed default', async () => {
    await store.save(order({ budgets: { agents: 1, wallClockMinutes: 5, tokens: null } }))
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as { ready: string[] }
    expect(r.ready.length).toBeLessThanOrEqual(2)
  })
})

function twoLanes(): WorkOrder {
  const base = order()
  return {
    ...base,
    plan: {
      ...base.plan,
      sharedFiles: ['proto/session.proto'],
      lanes: [
        { ord: 1, repo: 'proto', branch: '', role: 'producer', blocks: [2], blockedBy: [] },
        { ord: 2, repo: 'cli', branch: '', role: 'consumer', blocks: [], blockedBy: [1] },
      ],
      units: [
        builderUnit('U-1', {
          title: 'the contract',
          satisfies: ['AC-1'],
          touches: ['proto/session.proto'],
        }),
        builderUnit('U-2', {
          title: 'adopt it',
          lane: 2,
          satisfies: ['AC-1'],
          touches: ['proto/session.proto'],
        }),
      ],
    },
  }
}
interface Observed {
  lanes: {
    ord: number
    repo: string
    role: string | null
    collisions: string[]
    blockedBy: number[]
    hold: string | null
  }[]
}

describe('what run.observe says about lanes (FR-067, FR-068)', () => {
  describe('lanes', runChannelsLanesTests)
})

function runChannelsLanesTests() {
  it('reports each lane in merge order, by repository', async () => {
    await store.save(twoLanes())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as Observed
    expect(r.lanes.map((l) => l.repo)).toEqual(['proto', 'cli'])
  })

  it('names the shared file on both lanes, not only on the producer', async () => {
    await store.save(twoLanes())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as Observed
    expect(r.lanes.length).toBeGreaterThan(1)
    for (const lane of r.lanes) expect(lane.collisions).toEqual(['proto/session.proto'])
  })

  it('gives the hold as a sentence, so the surface does not reassemble it', async () => {
    await store.save(twoLanes())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as Observed
    expect(r.lanes[0].hold).toBeNull()
    expect(r.lanes[1].hold).toContain('must merge first')
    expect(r.lanes[1].hold).toContain('proto/session.proto')
  })

  it('reports one unremarkable lane for a single-repository order', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as Observed
    expect(r.lanes).toHaveLength(1)
    expect(r.lanes[0]).toMatchObject({ collisions: [], blockedBy: [], hold: null })
  })
}

describe('the graph is actually run (FR-020)', () => {
  describe('handing over', handingOverTests)
  describe('failures and refusals', failuresAndRefusalsTests)
})

function live(execute?: ReturnType<typeof vi.fn>) {
  return createRunChannels(
    runDeps({
      execute: (execute ?? vi.fn(async () => undefined)) as never,
    })
  )
}
async function started(execute?: ReturnType<typeof vi.fn>) {
  await store.save(order())
  const channels = live(execute)
  await channels.start({ id: 'WO-1' })
  return channels
}

function handingOverTests() {
  it('hands the graph to whatever executes it', async () => {
    await store.save(order())
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    const r = (await createRunChannels(
      runDeps({
        execute,
      })
    ).start({ id: 'WO-1' })) as { started: boolean }

    expect(r.started).toBe(true)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ steps: expect.anything() }),
      expect.objectContaining({ nodes: expect.anything() })
    )
  })

  it('does not wait for the run to finish before answering', async () => {
    await store.save(order())
    let released = (): void => {}
    const execute = vi.fn(() => new Promise<void>((r) => (released = r)))
    const r = await createRunChannels(
      runDeps({
        execute: execute as never,
      })
    ).start({ id: 'WO-1' })

    // Answered while the run is still going: a channel that blocked until the
    // last agent finished would hold the bridge for the length of the work.
    expect(r).toMatchObject({ started: true })
    released()
  })
}

function failuresAndRefusalsTests() {
  it('records a run that failed to start rather than losing it', async () => {
    await store.save(order())
    await createRunChannels(
      runDeps({
        execute: async () => Promise.reject(new Error('no worktree could be prepared')),
      })
    ).start({ id: 'WO-1' })

    // The rejection is handled off the call — that is the point of not
    // awaiting it — so wait for the entry rather than assuming one turn of the
    // microtask queue is enough.
    const ledgerFile = path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl')
    await vi.waitFor(() => expect(fs.readFileSync(ledgerFile, 'utf8')).toContain('run.failed'))
    const ledger = fs.readFileSync(ledgerFile, 'utf8')
    expect(ledger).toContain('run.failed')
    expect(ledger).toContain('no worktree could be prepared')
  })

  it('runs nothing for an order that was refused', async () => {
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    await createRunChannels(
      runDeps({
        execute,
      })
    ).start({ id: 'WO-nope' })
    expect(execute).not.toHaveBeenCalled()
  })
}

describe('foundry:run.resume', () => {
  describe('picking up', runChannelsPickingUpTests)
  describe('retrying', runChannelsRetryingTests)
  describe('recording the resume', recordingTheResumeTests)
  describe('refusals', runChannelsRefusalsTests)
})

function runChannelsPickingUpTests() {
  it('picks the run back up from the graph on disk', async () => {
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    const channels = await started(execute)
    execute.mockClear()

    const r = (await channels.resume({ id: 'WO-1' })) as { started: boolean }
    expect(r.started).toBe(true)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'WO-1' }),
      expect.anything(),
      expect.objectContaining({ nodes: expect.anything() })
    )
  })
}

function runChannelsRetryingTests() {
  it('retries the node the operator sent back', async () => {
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    const channels = await started(execute)

    // Fail a node, as a run would.
    const file = path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json')
    const graph = JSON.parse(fs.readFileSync(file, 'utf8')) as RunGraph
    const failed = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.unitIds.includes('U-1') ? { ...n, state: 'failed', attempts: 1 } : n
      ),
    }
    fs.writeFileSync(file, JSON.stringify(failed))
    execute.mockClear()

    const nodeId = failed.nodes.find((n) => n.unitIds.includes('U-1'))?.id ?? ''
    await channels.resume({ id: 'WO-1', retry: [nodeId] })

    // Back in the queue — `waiting`, which is where the scheduler picks it
    // up. `ready` is a state the scheduler assigns, not the resume.
    const handed = execute.mock.calls[0][2] as RunGraph
    expect(handed.nodes.find((n) => n.id === nodeId)?.state).toBe('waiting')
  })

  it('leaves everything else where it was', async () => {
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    const channels = await started(execute)
    execute.mockClear()

    await channels.resume({ id: 'WO-1', retry: [] })
    const handed = execute.mock.calls[0][2] as RunGraph
    expect(handed.nodes.every((n) => n.state !== 'failed')).toBe(true)
  })
}

function recordingTheResumeTests() {
  // Clears any `run.failed` a previous attempt left behind — without this a
  // retry that goes on to succeed still reads `stopped`, because the ledger's
  // newest run-shaped line stays the old failure for ever.
  it('records that the run was resumed', async () => {
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    const channels = await started(execute)

    await channels.resume({ id: 'WO-1' })

    const ledgerFile = path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl')
    const ledger = fs.readFileSync(ledgerFile, 'utf8')
    expect(ledger).toContain('run.resumed')
  })
}

function runChannelsRefusalsTests() {
  it('refuses an order that is not running', async () => {
    await store.save(order({ status: 'agreed' }))
    expect(await live().resume({ id: 'WO-1' })).toEqual({
      error: 'Only a running order can be resumed; this one is agreed.',
    })
  })

  it('refuses an order with no run on disk', async () => {
    await store.save(order({ status: 'running', recipe: 'direct' }))
    expect(await live().resume({ id: 'WO-1' })).toEqual({ error: 'No run for WO-1.' })
  })

  it('reports an order it cannot find', async () => {
    expect(await live().resume({ id: 'WO-nope' })).toEqual({ error: 'No order WO-nope.' })
  })
}

describe('what the Floor is told to call each node', () => {
  it('supplies a label per node, so a chip does not read "n2"', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const view = (await freshRunChannels().observe({ id: 'WO-1' })) as {
      labels: Record<string, string>
    }
    expect(Object.keys(view.labels).length).toBeGreaterThan(0)
    expect(Object.values(view.labels).some((label) => label.includes('U-1'))).toBe(true)
    expect(Object.values(view.labels).every((label) => /^n\d+$/.test(label))).toBe(false)
  })

  it('says what a blocked node is waiting on in the same words the chips use', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const view = (await freshRunChannels().observe({ id: 'WO-1' })) as {
      labels: Record<string, string>
      blocked: { id: string; reason: string }[]
    }
    const waiting = view.blocked.find((b) => b.reason.startsWith('waiting on '))
    expect(waiting).toBeDefined()
    const named = waiting?.reason.replace('waiting on ', '').split(', ') ?? []
    expect(named.length).toBeGreaterThan(0)
    for (const name of named) expect(Object.values(view.labels)).toContain(name)
  })
})

// Per-hunk review ended with the review queue, so nothing counts finished
// turns and nothing refuses a run because of them. A deps object that still
// carries the old gate must not be able to hold a start back.
describe('a start is never refused for finished turns waiting on review', () => {
  const full = () => ({
    allowed: false,
    unreviewed: 3,
    limit: 3,
    reason: '3 finished sessions are waiting for review, and the limit is 3.',
  })

  it('starts even when a legacy gate says there is no room', async () => {
    await store.save(order())
    // Not a RunDeps field any more: the old gate rides along as a stray property.
    const legacyDeps = { ...runDeps(), backpressure: full }
    const legacy = createRunChannels(legacyDeps)
    const r = (await legacy.start({ id: 'WO-1' })) as { error?: string }
    expect(r.error).toBeUndefined()
    expect((await store.load('WO-1'))?.status).toBe('running')
    const ledger = fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
    expect(ledger).not.toContain('backpressure.overridden')
  })
})

const nothingLive = (): boolean => false
const everythingLive = (): boolean => true
function withRunning(): { nodeId: string } {
  const file = path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json')
  const graph = JSON.parse(fs.readFileSync(file, 'utf8')) as RunGraph
  const nodeId = graph.nodes.find((n) => n.unitIds.includes('U-1'))?.id ?? ''
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === nodeId ? { ...n, state: 'running', sessionId: 'gone', attempts: 1 } : n
      ),
    })
  )
  return { nodeId }
}
async function startedRunChannels(
  over: Partial<Parameters<typeof createRunChannels>[0]> = {}
): Promise<ReturnType<typeof createRunChannels>> {
  await store.save(order())
  const channels = createRunChannels(
    runDeps({
      execute: vi.fn(async () => undefined) as never,
      ...over,
    })
  )
  await channels.start({ id: 'WO-1' })
  return channels
}

// ── Picking a run back up after the application closed ───────────────────
//
// An agent's terminal is a child of this process, so quitting kills it while
// the graph on disk goes on saying `running`. Before this, a reopened run
// raised nothing, started nothing and drew "building" for ever, and resuming
// it did nothing at all — the scheduler offers only `waiting` and `ready`.

describe('a run whose agents are gone', () => {
  describe('taking nodes back', takingNodesBackTests)
  describe('live agents and running executors', liveAgentsAndRunningExecutorsTests)
  describe('observing orphans', observingOrphansTests)
  describe('attaching', attachingTests)
})

function takingNodesBackTests() {
  it('resume takes the node back so the scheduler can offer it again', async () => {
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    const channels = await startedRunChannels({
      execute: execute as never,
      isLive: nothingLive,
    })
    const { nodeId } = withRunning()
    execute.mockClear()

    await channels.resume({ id: 'WO-1' })
    const handed = execute.mock.calls[0][2] as RunGraph
    expect(handed.nodes.find((n) => n.id === nodeId)?.state).toBe('waiting')
  })

  it('says what it took back, so the answer is not silent', async () => {
    const channels = await startedRunChannels({ isLive: nothingLive })
    const { nodeId } = withRunning()
    expect(await channels.resume({ id: 'WO-1' })).toMatchObject({ reclaimed: [nodeId] })
  })

  it('writes the reclaimed graph down, so a reopened surface reads it too', async () => {
    const channels = await startedRunChannels({ isLive: nothingLive })
    const { nodeId } = withRunning()
    await channels.resume({ id: 'WO-1' })

    const file = path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json')
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as RunGraph
    expect(saved.nodes.find((n) => n.id === nodeId)?.state).toBe('waiting')
  })
}

function liveAgentsAndRunningExecutorsTests() {
  it('leaves a node alone whose agent is still in its terminal', async () => {
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    const channels = await startedRunChannels({
      execute: execute as never,
      isLive: everythingLive,
    })
    const { nodeId } = withRunning()
    execute.mockClear()

    await channels.resume({ id: 'WO-1' })
    const handed = execute.mock.calls[0][2] as RunGraph
    expect(handed.nodes.find((n) => n.id === nodeId)?.state).toBe('running')
  })

  it('refuses to resume, and starts no second executor, while one is already running this order', async () => {
    const execute = vi.fn<RunDeps['execute']>(async () => undefined)
    const channels = await startedRunChannels({
      execute: execute as never,
      isLive: nothingLive,
      executing: () => true,
    })
    withRunning()
    execute.mockClear()

    const r = (await channels.resume({ id: 'WO-1' })) as { error?: string }
    expect(r.error).toBe('This run is already going; nothing to resume.')
    expect(execute).not.toHaveBeenCalled()
  })
}

function observingOrphansTests() {
  it('observe names the nodes nothing is running, so the surface can say so', async () => {
    const channels = await startedRunChannels({ isLive: nothingLive })
    const { nodeId } = withRunning()
    const view = (await channels.observe({ id: 'WO-1' })) as { orphaned: string[] }
    expect(view.orphaned).toEqual([nodeId])
  })

  it('observe reports no orphans while an executor is still running the order', async () => {
    const channels = await startedRunChannels({
      isLive: nothingLive,
      executing: () => true,
    })
    withRunning()
    const view = (await channels.observe({ id: 'WO-1' })) as { orphaned: string[] }
    expect(view.orphaned).toEqual([])
  })

  it('observe says nothing is orphaned when every agent is live', async () => {
    const channels = await startedRunChannels({ isLive: everythingLive })
    withRunning()
    const view = (await channels.observe({ id: 'WO-1' })) as { orphaned: string[] }
    expect(view.orphaned).toEqual([])
  })
}

function attachingTests() {
  it('refuses to attach to a session this process no longer has', async () => {
    const channels = await startedRunChannels({ isLive: nothingLive })
    const { nodeId } = withRunning()
    expect(await channels.attach({ orderId: 'WO-1', nodeId })).toEqual({
      error: `${nodeId} has no live agent — its session ended when the application last closed. Resume the run to start it again.`,
    })
  })
}

describe('the run timeline', () => {
  describe('recording frames', recordingFramesTests)
  describe('the timeline', theTimelineTests)
})

function recordingFramesTests() {
  it('records a frame of every node’s standing when a run starts', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const timeline = await readTimeline(path.join(dataRoot, 'orders', 'WO-1'))
    expect(timeline.frames).toHaveLength(1)
    expect(timeline.frames[0].nodes.length).toBeGreaterThan(0)
  })
}

function theTimelineTests() {
  it('hands back the graph, the recording and every gate the order raised', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const gate = { id: 'g-1', orderId: 'WO-1' }
    const withGates = createRunChannels(
      runDeps({
        gatesFor: async () => [gate as never],
      })
    )
    const r = (await withGates.timeline({ id: 'WO-1' })) as {
      graph: RunGraph
      timeline: { frames: unknown[]; tools: unknown[] }
      gates: unknown[]
    }
    expect(r.graph.orderId).toBe('WO-1')
    expect(r.timeline.frames).toHaveLength(1)
    expect(r.timeline.tools).toEqual([])
    expect(r.gates).toEqual([gate])
  })

  it('says so for an order with no run', async () => {
    expect(await freshRunChannels().timeline({ id: 'WO-1' })).toEqual({ error: 'No run for WO-1.' })
  })

  it('hands back no gates when the host has no gate store to ask', async () => {
    await store.save(order())
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().timeline({ id: 'WO-1' })) as { gates: unknown[] }
    expect(r.gates).toEqual([])
  })
}

function documentOnTheFloorTests() {
  async function observedDocument(document: WorkOrder['document']): Promise<unknown> {
    await store.save(order({ document }))
    await freshRunChannels().start({ id: 'WO-1' })
    const r = (await freshRunChannels().observe({ id: 'WO-1' })) as { document: unknown }
    return r.document
  }

  it('reports a published document with its kind, link and local copy', async () => {
    const url = 'https://example.com/report'
    expect(await observedDocument({ path: 'r.md', url, location: 'published' })).toEqual({
      kind: 'link',
      url,
      path: expect.stringMatching(/\/orders\/WO-1\/r\.md$/),
    })
  })

  it('reports none for a document in the checkout, and none handed back', async () => {
    expect(await observedDocument({ path: 'docs/a.md', location: 'checkout' })).toBeNull()
    expect(await observedDocument(null)).toBeNull()
  })
}
