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
    // Resolved on every call in the host, because the records location follows
    // the open workspace — a fixed value here is what that resolver returns.
    dataRoot: () => dataRoot,
    sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
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
    expect(proposeRecipe(order({ recipe: 'bugfix' }))).toEqual({
      name: 'bugfix',
      why: 'the order already names this shape',
    })
  })

  it('proposes the direct shape for one low-risk unit', () => {
    const proposal = proposeRecipe(
      order({ risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] } })
    )
    expect(proposal.name).toBe('direct')
    expect(proposal.why).toBe('one unit of work, graded P3')
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
    const proposal = proposeRecipe(o)
    expect(proposal.name).toBe('standard')
    expect(proposal.why).toBe('2 units of work')
  })

  it('proposes the standard shape for anything above the lowest risk', () => {
    const proposal = proposeRecipe(
      order({ risk: { grade: 'P1', triggers: [], blastRadius: [], criticalPaths: [] } })
    )
    expect(proposal.name).toBe('standard')
    expect(proposal.why).toContain("above the direct shape's ceiling")
  })
})

describe('the reason a shape was chosen (FR-014)', () => {
  function ledgerText(): string {
    return fs.readFileSync(path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')
  }

  it('records why the system picked the shape, not only where it came from', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const text = ledgerText()
    expect(text).toContain('role:architect')
    expect(text).toContain('one unit of work, graded P3')
    expect(text).toContain('resolved from built-in')
  })

  it('says the operator chose it when the operator chose it', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1', recipe: 'standard' })
    expect(ledgerText()).toContain('chosen by the operator')
  })

  it('offers the reason alongside the proposal', async () => {
    await store.save(order())
    const view = (await channels().recipes({ id: 'WO-1' })) as {
      proposed: string
      proposedWhy: string
    }
    expect(view.proposed).toBe('direct')
    expect(view.proposedWhy).toBe('one unit of work, graded P3')
  })
})

describe('the records location', () => {
  it('refuses to start when the records location cannot be written to, before any work begins', async () => {
    await store.save(order())
    const wall = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-wall-'))
    fs.chmodSync(wall, 0o500)
    const blocked = createRunChannels({
      store,
      dataRoot: () => path.join(wall, 'foundry'),
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
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
    expect(r.lanes.length).toBeGreaterThan(1)
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

describe('the graph is actually run (FR-020)', () => {
  it('hands the graph to whatever executes it', async () => {
    await store.save(order())
    const execute = vi.fn(async () => undefined)
    const r = (await createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => '2026-09-06T10:00:00.000Z',
      execute,
    }).start({ id: 'WO-1' })) as { started: boolean }

    expect(r.started).toBe(true)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ steps: expect.anything() }),
      expect.objectContaining({ nodes: expect.anything() })
    )
  })

  it('says so when there is nothing to run it, rather than reporting a started run', async () => {
    await store.save(order())
    const r = (await channels().start({ id: 'WO-1' })) as { started: boolean; reason: string }
    expect(r.started).toBe(false)
    expect(r.reason).toMatch(/not available/)
  })

  it('does not wait for the run to finish before answering', async () => {
    await store.save(order())
    let released = (): void => {}
    const execute = vi.fn(() => new Promise<void>((r) => (released = r)))
    const r = await createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => '2026-09-06T10:00:00.000Z',
      execute: execute as never,
    }).start({ id: 'WO-1' })

    // Answered while the run is still going: a channel that blocked until the
    // last agent finished would hold the bridge for the length of the work.
    expect(r).toMatchObject({ started: true })
    released()
  })

  it('records a run that failed to start rather than losing it', async () => {
    await store.save(order())
    await createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => '2026-09-06T10:00:00.000Z',
      execute: async () => Promise.reject(new Error('no worktree could be prepared')),
    }).start({ id: 'WO-1' })

    // The rejection is handled off the call — that is the point of not
    // awaiting it — so poll for the entry rather than assuming one turn of the
    // microtask queue is enough. One turn passed most of the time, which is
    // the worst kind of enough.
    const ledgerFile = path.join(dataRoot, 'orders', 'WO-1', 'ledger.jsonl')
    let ledger = ''
    for (let attempt = 0; attempt < 50 && !ledger.includes('run.failed'); attempt++) {
      await new Promise((r) => setTimeout(r, 10))
      ledger = fs.readFileSync(ledgerFile, 'utf8')
    }
    expect(ledger).toContain('run.failed')
    expect(ledger).toContain('no worktree could be prepared')
  })

  it('runs nothing for an order that was refused', async () => {
    const execute = vi.fn(async () => undefined)
    await createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => '2026-09-06T10:00:00.000Z',
      execute,
    }).start({ id: 'WO-nope' })
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('foundry:run.resume', () => {
  function live(execute?: ReturnType<typeof vi.fn>) {
    return createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => '2026-09-06T10:00:00.000Z',
      execute: (execute ?? vi.fn(async () => undefined)) as never,
    })
  }

  async function started(execute?: ReturnType<typeof vi.fn>) {
    await store.save(order())
    const channels = live(execute)
    await channels.start({ id: 'WO-1' })
    return channels
  }

  it('picks the run back up from the graph on disk', async () => {
    const execute = vi.fn(async () => undefined)
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

  it('retries the node the operator sent back', async () => {
    const execute = vi.fn(async () => undefined)
    const channels = await started(execute)

    // Fail a node, as a run would.
    const file = path.join(dataRoot, 'orders', 'WO-1', 'run-graph.json')
    const graph = JSON.parse(fs.readFileSync(file, 'utf8')) as RunGraph
    const failed = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.unitId === 'U-1' ? { ...n, state: 'failed', attempts: 1 } : n
      ),
    }
    fs.writeFileSync(file, JSON.stringify(failed))
    execute.mockClear()

    const nodeId = failed.nodes.find((n) => n.unitId === 'U-1')?.id ?? ''
    await channels.resume({ id: 'WO-1', retry: [nodeId] })

    // Back in the queue — `waiting`, which is where the scheduler picks it
    // up. `ready` is a state the scheduler assigns, not the resume.
    const handed = execute.mock.calls[0][2] as RunGraph
    expect(handed.nodes.find((n) => n.id === nodeId)?.state).toBe('waiting')
  })

  it('leaves everything else where it was', async () => {
    const execute = vi.fn(async () => undefined)
    const channels = await started(execute)
    execute.mockClear()

    await channels.resume({ id: 'WO-1', retry: [] })
    const handed = execute.mock.calls[0][2] as RunGraph
    expect(handed.nodes.every((n) => n.state !== 'failed')).toBe(true)
  })

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

  it('rejects a malformed request', async () => {
    expect(await live().resume({ retry: 'U-1' })).toEqual({ error: 'Malformed request.' })
  })

  it('says so when there is nothing to run it', async () => {
    await store.save(order())
    const channels = live()
    await channels.start({ id: 'WO-1' })
    const bare = createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => '2026-09-06T10:00:00.000Z',
    })
    expect(await bare.resume({ id: 'WO-1' })).toMatchObject({ started: false })
  })
})

describe('what the Floor is told to call each node', () => {
  it('supplies a label per node, so a chip does not read "n2"', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const view = (await channels().observe({ id: 'WO-1' })) as {
      labels: Record<string, string>
    }
    expect(Object.keys(view.labels).length).toBeGreaterThan(0)
    expect(Object.values(view.labels).some((label) => label.includes('U-1'))).toBe(true)
    expect(Object.values(view.labels).every((label) => /^n\d+$/.test(label))).toBe(false)
  })

  it('says what a blocked node is waiting on in the same words the chips use', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const view = (await channels().observe({ id: 'WO-1' })) as {
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
