import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunChannels, proposeRecipe } from '../../src/ipc/run-channels.js'
import { createOrderStore } from '../../src/order/store.js'
import type { OrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'

// Everything that can refuse a run refuses before any work begins. An order
// that fails half way through because a recipe could not run here has already
// spent agent time on a shape that was never going to finish.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let dataRoot: string
let repo: string
let store: OrderStore

function channels() {
  return createRunChannels({
    store,
    dataRoot,
    sources: { dataRoot, repoPaths: [repo], builtInDir },
    now: () => '2026-09-06T10:00:00.000Z',
  })
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
          title: 'a',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/a'],
          verify: [],
        },
      ],
    },
    ...over,
  }
}

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-run-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-run-repo-'))
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
  store = createOrderStore(dataRoot)
})

afterEach(() => {
  for (const dir of [dataRoot, repo]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('foundry:run.start', () => {
  it('builds a graph and moves the order to running', async () => {
    await store.save(order())
    const r = (await channels().start({ id: 'WO-1' })) as { graph: RunGraph; order: WorkOrder }
    expect(r.graph.nodes.length).toBeGreaterThan(0)
    expect(r.order.status).toBe('running')
    expect((await store.load('WO-1'))?.status).toBe('running')
  })

  it('persists the graph so a restart can pick it up', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    expect(fs.existsSync(path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json'))).toBe(true)
  })

  it('refuses an order that has not been agreed, without building anything', async () => {
    await store.save(order({ status: 'draft' }))
    const r = (await channels().start({ id: 'WO-1' })) as { error: string }
    expect(r.error).toMatch(/Only an agreed order/)
    expect(fs.existsSync(path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json'))).toBe(false)
  })

  it('refuses a shape this repository cannot support, and says why', async () => {
    await store.save(order())
    const r = (await channels().start({ id: 'WO-1', recipe: 'speckit' })) as { error: string }
    expect(r.error).toMatch(/cannot run here/)
    expect(r.error).toMatch(/\.specify/)
  })

  it('runs that same shape once the repository supports it', async () => {
    fs.mkdirSync(path.join(repo, '.specify'), { recursive: true })
    await store.save(order())
    const r = (await channels().start({ id: 'WO-1', recipe: 'speckit' })) as { graph: RunGraph }
    expect(r.graph.recipe).toBe('speckit')
  })

  it('records an operator override as an operator decision', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1', recipe: 'direct' })
    const saved = await store.load('WO-1')
    expect(saved?.recipeOverriddenBy).toBe('operator')
    const ledger = fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('"actor":"operator"')
  })

  it('records a proposal as the architect proposing, not the operator choosing', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    expect((await store.load('WO-1'))?.recipeOverriddenBy).toBeNull()
    const ledger = fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('role:architect')
  })

  it('records which rung the recipe came from', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    expect(
      fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
    ).toContain('built-in')
  })

  it('reports a recipe nobody defines', async () => {
    await store.save(order())
    const r = (await channels().start({ id: 'WO-1', recipe: 'nonesuch' })) as { error: string }
    expect(r.error).toMatch(/nonesuch/)
  })

  it('reports an order it cannot find', async () => {
    expect(await channels().start({ id: 'WO-nope' })).toEqual({ error: 'No order WO-nope.' })
  })

  it('rejects a malformed request', async () => {
    expect(await channels().start({ nope: true })).toEqual({ error: 'Malformed request.' })
  })
})

describe('foundry:run.observe', () => {
  it('reports the graph, what can start and what is waiting', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const r = (await channels().observe({ id: 'WO-1' })) as {
      graph: RunGraph
      ready: string[]
      blocked: { id: string; reason: string }[]
    }
    expect(r.ready.length).toBeGreaterThan(0)
    expect(r.blocked.some((b) => b.reason.startsWith('waiting on'))).toBe(true)
  })

  it('reports no run before one has started', async () => {
    await store.save(order())
    expect(await channels().observe({ id: 'WO-1' })).toEqual({ error: 'No run for WO-1.' })
  })
})

describe('foundry:run.recipes', () => {
  it('offers every shape, marking the ones this repository cannot support', async () => {
    await store.save(order())
    const r = (await channels().recipes({ id: 'WO-1' })) as {
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
    const r = (await channels().recipes({ id: 'WO-1' })) as { recipes: { rung: string }[] }
    expect(r.recipes.every((x) => x.rung === 'built-in')).toBe(true)
  })
})

describe('proposeRecipe', () => {
  it('keeps a shape the order already carries', () => {
    expect(proposeRecipe(order({ recipe: 'bugfix' }))).toBe('bugfix')
  })

  it('proposes the direct shape for one low-risk unit', () => {
    expect(
      proposeRecipe(
        order({ risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] } })
      )
    ).toBe('direct')
  })

  it('proposes the standard shape once there is more than one unit', () => {
    const o = order({ risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] } })
    o.plan.units.push({
      id: 'U-2',
      title: 'b',
      role: 'builder',
      lane: 1,
      dependsOn: [],
      satisfies: ['AC-1'],
      touches: [],
      verify: [],
    })
    expect(proposeRecipe(o)).toBe('standard')
  })

  it('proposes the standard shape for anything above the lowest risk', () => {
    expect(
      proposeRecipe(
        order({ risk: { grade: 'P1', triggers: [], blastRadius: [], criticalPaths: [] } })
      )
    ).toBe('standard')
  })
})

describe('the records location', () => {
  it('refuses to start when the records location cannot be written to, before any work begins', async () => {
    await store.save(order())
    const wall = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-wall-'))
    fs.chmodSync(wall, 0o500)
    const blocked = createRunChannels({
      store,
      dataRoot: path.join(wall, 'foundry'),
      sources: { dataRoot, repoPaths: [repo], builtInDir },
      now: () => '2026-09-06T10:00:00.000Z',
    })
    const r = (await blocked.start({ id: 'WO-1' })) as { error: string }
    fs.chmodSync(wall, 0o700)
    fs.rmSync(wall, { recursive: true, force: true })

    expect(r.error).toContain('foundry')
    // And the order is untouched — no half-started run.
    expect((await store.load('WO-1'))?.status).toBe('agreed')
  })
})

describe('attaching to a running agent', () => {
  it('returns the live session behind a node', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    // The scheduler stamps a session when it starts a node; simulate that.
    const graphPath = path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json')
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as {
      nodes: { id: string; sessionId: string | null }[]
    }
    graph.nodes[0].sessionId = 'sess-42'
    fs.writeFileSync(graphPath, JSON.stringify(graph))

    const r = (await channels().attach({ orderId: 'WO-1', nodeId: graph.nodes[0].id })) as {
      terminalSessionId: string
    }
    expect(r.terminalSessionId).toBe('sess-42')
  })

  it('says why rather than pretending, when a node has no session yet', async () => {
    await store.save(order())
    const started = (await channels().start({ id: 'WO-1' })) as {
      graph: { nodes: { id: string }[] }
    }
    const r = (await channels().attach({
      orderId: 'WO-1',
      nodeId: started.graph.nodes[0].id,
    })) as { error: string }
    expect(r.error).toMatch(/no session yet/)
  })

  it('reports a node that is not in the run', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const r = (await channels().attach({ orderId: 'WO-1', nodeId: 'nope' })) as { error: string }
    expect(r.error).toBe('No step nope.')
  })

  it('reports an order with no run', async () => {
    const r = (await channels().attach({ orderId: 'WO-nope', nodeId: 'x' })) as { error: string }
    expect(r.error).toBe('No run for WO-nope.')
  })

  it('rejects a malformed request', async () => {
    expect(await channels().attach({ nope: true })).toEqual({ error: 'Malformed request.' })
  })
})

describe('offering shapes of work', () => {
  it('rejects a malformed request', async () => {
    expect(await channels().recipes({ nope: true })).toEqual({ error: 'Malformed request.' })
  })

  it('reports an order it cannot find', async () => {
    expect(await channels().recipes({ id: 'WO-nope' })).toEqual({ error: 'No order WO-nope.' })
  })

  it('marks a malformed operator recipe as unavailable rather than hiding it', async () => {
    await store.save(order())
    fs.mkdirSync(path.join(dataRoot, 'recipes'), { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'recipes', 'broken.yaml'), 'id: [unclosed\n')
    const r = (await channels().recipes({ id: 'WO-1' })) as {
      recipes: { name: string; available: boolean }[]
    }
    expect(r.recipes.find((x) => x.name === 'broken')?.available).toBe(false)
  })

  it('observes with the order own budgets rather than a guessed default', async () => {
    await store.save(
      order({ budgets: { agents: 1, wallClockMinutes: 5, filesTouched: 2, tokens: null } })
    )
    await channels().start({ id: 'WO-1' })
    const r = (await channels().observe({ id: 'WO-1' })) as { ready: string[] }
    expect(r.ready.length).toBeLessThanOrEqual(2)
  })
})

describe('what run.observe says about lanes (FR-067, FR-068)', () => {
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
          {
            id: 'U-1',
            title: 'the contract',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['proto/session.proto'],
            verify: [],
          },
          {
            id: 'U-2',
            title: 'adopt it',
            role: 'builder',
            lane: 2,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['proto/session.proto'],
            verify: [],
          },
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

  it('reports each lane in merge order, by repository', async () => {
    await store.save(twoLanes())
    await channels().start({ id: 'WO-1' })
    const r = (await channels().observe({ id: 'WO-1' })) as Observed
    expect(r.lanes.map((l) => l.repo)).toEqual(['proto', 'cli'])
  })

  it('names the shared file on both lanes, not only on the producer', async () => {
    await store.save(twoLanes())
    await channels().start({ id: 'WO-1' })
    const r = (await channels().observe({ id: 'WO-1' })) as Observed
    for (const lane of r.lanes) expect(lane.collisions).toEqual(['proto/session.proto'])
  })

  it('gives the hold as a sentence, so the surface does not reassemble it', async () => {
    await store.save(twoLanes())
    await channels().start({ id: 'WO-1' })
    const r = (await channels().observe({ id: 'WO-1' })) as Observed
    expect(r.lanes[0].hold).toBeNull()
    expect(r.lanes[1].hold).toContain('must merge first')
    expect(r.lanes[1].hold).toContain('proto/session.proto')
  })

  it('reports one unremarkable lane for a single-repository order', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const r = (await channels().observe({ id: 'WO-1' })) as Observed
    expect(r.lanes).toHaveLength(1)
    expect(r.lanes[0]).toMatchObject({ collisions: [], blockedBy: [], hold: null })
  })
})
