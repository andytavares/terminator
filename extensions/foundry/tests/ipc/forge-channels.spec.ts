import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createForgeChannels } from '../../src/ipc/forge-channels.js'
import { createOrderStore } from '../../src/order/store.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { Standing } from '../../src/order/standing.js'
import type { OrderStore } from '../../src/order/store.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { CompileResult } from '../../src/order/compile.js'

let root: string
let repo: string
let store: OrderStore

interface OrderView {
  order: WorkOrder
  compile: CompileResult
  changed: string[]
  unavailableChecks?: string[]
}

function channels(readIssue?: ReturnType<typeof vi.fn>) {
  return createForgeChannels({
    store,
    now: () => '2026-09-06T10:00:00.000Z',
    readIssue: readIssue as never,
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-ipc-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-ipc-repo-'))
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run' } })
  )
  store = createOrderStore(root)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('foundry:order.create', () => {
  it('returns a saved draft with its checks already evaluated', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'rows are clipped at the right edge' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.status).toBe('draft')
    expect(r.compile.ok).toBe(false)
    expect(await store.load(r.order.id)).not.toBeNull()
  })

  it('reports which checks this repository cannot run', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.unavailableChecks).toContain('coverage')
  })

  it('runs the adversarial pass on the very first draft', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.redTeam.length).toBeGreaterThan(0)
  })

  it('records the seeding in the ledger', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const ledger = path.join(root, 'orders', r.order.id, 'ledger.jsonl')
    expect(fs.readFileSync(ledger, 'utf8')).toContain('order.seeded')
  })

  it('offers the existing order rather than seeding the same issue twice', async () => {
    const readIssue = vi.fn(async () => ({
      key: 'TAV-42',
      title: 'Clipping',
      description: 'd',
      url: 'u',
      branchName: null,
    }))
    const c = channels(readIssue)
    const first = (await c.create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42' },
      repoPaths: [repo],
    })) as OrderView
    const second = (await c.create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42' },
      repoPaths: [repo],
    })) as { existing: { id: string } }
    expect(second.existing.id).toBe(first.order.id)
  })

  it('rejects a malformed request without touching the store', async () => {
    expect(await channels().create({ nonsense: true })).toEqual({ error: 'Malformed request.' })
    expect(await store.list()).toEqual([])
  })
})

describe('foundry:order.turn', () => {
  async function seeded(): Promise<WorkOrder> {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const withExtras: WorkOrder = {
      ...r.order,
      assumptions: [{ id: 'A-1', text: 'single repo', struck: false, affects: ['U-1'] }],
      openQuestions: [
        {
          id: 'Q-1',
          text: 'does it?',
          why: '',
          options: ['No', 'Yes'],
          recommended: 0,
          answer: null,
          rank: 1,
        },
      ],
    }
    await store.save(withExtras)
    return withExtras
  }

  it('strikes an assumption and says exactly what has to be redrawn', async () => {
    const order = await seeded()
    const r = (await channels().turn({ id: order.id, strike: 'A-1' })) as OrderView
    expect(r.changed).toEqual(['U-1'])
    expect(r.order.assumptions[0].struck).toBe(true)
  })

  it('answers a question by the index of its option', async () => {
    const order = await seeded()
    const r = (await channels().turn({
      id: order.id,
      answer: { questionId: 'Q-1', option: 1 },
    })) as OrderView
    expect(r.order.openQuestions[0].answer).toBe('Yes')
  })

  it('persists the turn rather than only returning it', async () => {
    const order = await seeded()
    await channels().turn({ id: order.id, strike: 'A-1' })
    expect((await store.load(order.id))?.assumptions[0].struck).toBe(true)
  })

  it('records every turn in the ledger', async () => {
    const order = await seeded()
    await channels().turn({ id: order.id, answer: { questionId: 'Q-1', option: 0 } })
    const ledger = fs.readFileSync(path.join(root, 'orders', order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('question.answered')
  })

  it('returns the order unchanged for free text, which goes to the session instead', async () => {
    const order = await seeded()
    const r = (await channels().turn({ id: order.id, message: 'what about resize?' })) as OrderView
    expect(r.changed).toEqual([])
  })

  it('reports an order it cannot find', async () => {
    expect(await channels().turn({ id: 'WO-nope', strike: 'A-1' })).toEqual({
      error: 'No order WO-nope.',
    })
  })
})

describe('foundry:order.compile', () => {
  async function completeOrder(): Promise<WorkOrder> {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const done: WorkOrder = {
      ...r.order,
      intent: { problem: 'p', outcome: 'rows render fully', nonGoals: ['scrollbars'] },
      risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
      acceptance: [
        {
          id: 'AC-1',
          statement: 'a full-width row renders its final glyph',
          priority: 'P1',
          verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
          unverifiable: null,
        },
      ],
      plan: {
        ...r.order.plan,
        units: [
          {
            id: 'U-1',
            title: 'widen',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['src/a.ts'],
            verify: [],
          },
        ],
      },
      redTeam: r.order.redTeam.map((f) => ({ ...f, status: 'resolved' as const })),
    }
    await store.save(done)
    return done
  }

  it('previews the checks without committing when asked not to', async () => {
    const order = await completeOrder()
    const r = (await channels().compile({ id: order.id, commit: false })) as OrderView
    expect(r.compile.ok).toBe(true)
    expect((await store.load(order.id))?.status).toBe('draft')
  })

  it('agrees a complete order and stamps when', async () => {
    const order = await completeOrder()
    const r = (await channels().compile({ id: order.id, commit: true })) as OrderView
    expect(r.order.status).toBe('agreed')
    expect((await store.load(order.id))?.agreedAt).toBe('2026-09-06T10:00:00.000Z')
  })

  it('leaves an incomplete order a draft and names what is missing', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const out = (await channels().compile({ id: r.order.id, commit: true })) as OrderView
    expect(out.compile.ok).toBe(false)
    expect(out.order.status).toBe('draft')
    expect(out.compile.failures.map((f) => f.check)).toContain('coverage')
  })

  it('records the agreement in the ledger', async () => {
    const order = await completeOrder()
    await channels().compile({ id: order.id, commit: true })
    expect(fs.readFileSync(path.join(root, 'orders', order.id, 'ledger.jsonl'), 'utf8')).toContain(
      'order.agreed'
    )
  })

  it('reports an order it cannot find', async () => {
    expect(await channels().compile({ id: 'WO-nope', commit: true })).toEqual({
      error: 'No order WO-nope.',
    })
  })
})

describe('foundry:order.list', () => {
  it('lists nothing before any order is seeded', async () => {
    expect(await channels().list()).toEqual({ orders: [] })
  })

  it('lists each order with where its checks stand', async () => {
    const c = channels()
    await c.create({ source: { kind: 'typed', text: 'first idea' }, repoPaths: [repo] })
    const r = (await c.list()) as { orders: { title: string; status: string; failures: number }[] }
    expect(r.orders).toHaveLength(1)
    expect(r.orders[0].title).toContain('first idea')
    expect(r.orders[0].status).toBe('draft')
    // A fresh draft has nothing planned yet, so at least coverage is failing.
    expect(r.orders[0].failures).toBeGreaterThan(0)
  })

  // The row used to read `failures === 0 ? 'ready to hand off' : ...`, and
  // `failures` is a draft-time compile result that is zero for every running
  // order for ever. Every running order therefore claimed to be ready to hand
  // off — including one halted at an undecided gate two hours earlier.
  it('never says a running order is ready to hand off', async () => {
    const c = channels()
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const loaded = await store.load(seeded.order.id)
    if (loaded === null) throw new Error('the order this test needs was not saved')
    await store.save({ ...loaded, status: 'running' })

    const r = (await c.list()) as { orders: { standing: Standing }[] }
    expect(r.orders).toHaveLength(1)
    expect(r.orders[0].standing.label).not.toContain('hand off')
    expect(r.orders[0].standing.kind).not.toBe('done')
  })

  it('says a halted order is halted, and whose move it is', async () => {
    const held = raiseGate({
      id: 'G-1',
      rule: 'budget.exceeded',
      orderId: 'WO-x',
      summary: 'past its wall clock budget',
      why: 'the order budgets 90 and this run is at 90',
      at: '2026-09-06T11:30:00.000Z',
    })
    const c = createForgeChannels({
      store,
      now: () => '2026-09-06T10:00:00.000Z',
      standingSources: { gatesFor: async () => [held] },
    })
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const loaded = await store.load(seeded.order.id)
    if (loaded === null) throw new Error('the order this test needs was not saved')
    await store.save({ ...loaded, status: 'running' })

    const r = (await c.list()) as { orders: { standing: Standing }[] }
    expect(r.orders).toHaveLength(1)
    expect(r.orders[0].standing.kind).toBe('halted')
    expect(r.orders[0].standing.turn).toBe('you')
    expect(r.orders[0].standing.gateId).toBe('G-1')
  })

  // A draft's standing is the questions it is asking, which is the count the
  // tab badge sends the operator here to find.
  it('counts the questions a draft is still asking', async () => {
    const c = channels()
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const loaded = await store.load(seeded.order.id)
    if (loaded === null) throw new Error('the order this test needs was not saved')
    await store.save({
      ...loaded,
      openQuestions: [
        {
          id: 'Q-1',
          text: 'a?',
          why: '',
          options: ['x', 'y'],
          recommended: 0,
          answer: null,
          rank: 1,
        },
      ],
    })

    const r = (await c.list()) as { orders: { standing: Standing; openQuestions: number }[] }
    expect(r.orders[0].standing.kind).toBe('shaping')
    expect(r.orders[0].standing.turn).toBe('you')
    expect(r.orders[0].openQuestions).toBe(1)
  })
})

describe('channel edge cases', () => {
  it('reports an issue the tracker cannot return', async () => {
    const c = channels(vi.fn(async () => null))
    expect(
      await c.create({
        source: { kind: 'tracker', tracker: 'linear', key: 'TAV-99' },
        repoPaths: [repo],
      })
    ).toEqual({ error: 'Could not read TAV-99 from linear.' })
  })

  it('refuses to seed with no repository, without writing anything', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [],
    })) as { error: string }
    expect(r.error).toMatch(/at least one repository/)
    expect(await store.list()).toEqual([])
  })

  it('defaults to Linear when a tracker source names no tracker', async () => {
    const readIssue = vi.fn(async () => null)
    await channels(readIssue).create({
      source: { kind: 'tracker', key: 'TAV-1' },
      repoPaths: [repo],
    })
    expect(readIssue).toHaveBeenCalledWith('linear', 'TAV-1')
  })

  it('rejects a malformed turn', async () => {
    expect(await channels().turn({ nope: true })).toEqual({ error: 'Malformed request.' })
  })

  it('rejects a malformed compile request', async () => {
    expect(await channels().compile({ nope: true })).toEqual({ error: 'Malformed request.' })
  })

  it('treats a compile with no commit flag as a preview', async () => {
    const seeded = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const r = (await channels().compile({ id: seeded.order.id })) as OrderView
    expect(r.order.status).toBe('draft')
  })

  it('refuses to agree an order that is no longer a draft', async () => {
    const seeded = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    await store.save({ ...seeded.order, status: 'running' })
    const r = (await channels().compile({ id: seeded.order.id, commit: true })) as OrderView
    expect(r.compile.ok).toBe(false)
  })

  it('ignores an answer to a question that does not exist', async () => {
    const seeded = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const r = (await channels().turn({
      id: seeded.order.id,
      answer: { questionId: 'Q-nope', option: 'x' },
    })) as OrderView
    expect(r.order.openQuestions).toEqual([])
  })

  it('seeds without a tracker reader at all', async () => {
    const c = createForgeChannels({ store, now: () => '2026-09-06T10:00:00.000Z' })
    const r = (await c.create({
      source: { kind: 'typed', text: 'no tracker here' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.id).toBeTruthy()
  })
})

// The write-back seams. Everything below builds its own channel set, because
// what is being asserted is what the seams are handed and when.

const NOW = '2026-09-06T10:00:00.000Z'

/** An order that will pass all six checks, so `commit: true` actually agrees. */
async function agreeable(): Promise<WorkOrder> {
  const seed = (await channels().create({
    source: { kind: 'typed', text: 'rows are clipped at the right edge' },
    repoPaths: [repo],
  })) as OrderView
  const done: WorkOrder = {
    ...seed.order,
    id: 'WO-1',
    // Seeded as typed and then pointed at an issue, because seeding from a
    // tracker needs a reader and what is under test here is the write-back.
    source: {
      kind: 'tracker',
      tracker: 'linear',
      key: 'TAV-42',
      url: 'https://linear.app/tav/issue/TAV-42',
    },
    intent: { problem: 'p', outcome: 'rows render fully', nonGoals: ['scrollbars'] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a full-width row renders its final glyph',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: {
      ...seed.order.plan,
      units: [
        {
          id: 'U-1',
          title: 'widen',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/a.ts'],
          verify: [],
        },
      ],
    },
    redTeam: seed.order.redTeam.map((f) => ({ ...f, status: 'resolved' as const })),
  }
  return done
}

describe('the capability check at agreement (FR-059a)', () => {
  it('asks what the tracker can do when the order is agreed, not when a write is due', async () => {
    const capability = vi.fn(async () => ({
      transitions: 'unsupported' as const,
      states: [],
      unreachable: [],
    }))
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels({ store, now: () => NOW, capability })

    const result = (await channels.compile({ id: 'WO-1', commit: true })) as {
      capability?: { transitions: string }
    }
    expect(capability).toHaveBeenCalled()
    expect(result.capability?.transitions).toBe('unsupported')
  })

  it('asks nothing when the order is only being checked, not handed off', async () => {
    const capability = vi.fn(async () => ({
      transitions: 'supported' as const,
      states: [],
      unreachable: [],
    }))
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels({ store, now: () => NOW, capability })

    await channels.compile({ id: 'WO-1', commit: false })
    expect(capability).not.toHaveBeenCalled()
  })

  it('agrees the order even when the tracker cannot be reached', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels({
      store,
      now: () => NOW,
      capability: async () => Promise.reject(new Error('offline')),
    })

    const result = (await channels.compile({ id: 'WO-1', commit: true })) as { order: WorkOrder }
    expect(result.order.status).toBe('agreed')
  })

  it('agrees the order even when the summary comment fails', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels({
      store,
      now: () => NOW,
      onAgreed: async () => Promise.reject(new Error('rate limited')),
    })

    const result = (await channels.compile({ id: 'WO-1', commit: true })) as { order: WorkOrder }
    expect(result.order.status).toBe('agreed')
    expect((await store.load('WO-1'))?.status).toBe('agreed')
  })

  it('writes the agreed order back to the issue', async () => {
    const onAgreed = vi.fn(async () => undefined)
    const store = createOrderStore(root)
    await store.save(await agreeable())
    await createForgeChannels({ store, now: () => NOW, onAgreed }).compile({
      id: 'WO-1',
      commit: true,
    })
    expect(onAgreed).toHaveBeenCalledWith(expect.objectContaining({ status: 'agreed' }))
  })
})

describe('the intent-to-state mapping (FR-060)', () => {
  it('offers the tracker states and the mapping as it stands', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels({
      store,
      now: () => NOW,
      capability: async () => ({
        transitions: 'supported' as const,
        states: [
          { id: 'st-review', name: 'In Review', intent: 'in_review' as const, available: true },
        ],
        unreachable: [],
      }),
    })

    const result = (await channels.states({ id: 'WO-1' })) as {
      capability: { states: { id: string }[] }
      mapping: Record<string, string | null>
    }
    expect(result.capability.states[0].id).toBe('st-review')
    expect(result.mapping.in_review).toBeNull()
  })

  it('reports no issue when the host has no tracker connection at all', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const result = (await createForgeChannels({ store, now: () => NOW }).states({
      id: 'WO-1',
    })) as { capability: { transitions: string } }
    expect(result.capability.transitions).toBe('no_issue')
  })

  it('reports the tracker own failure rather than pretending it has no states', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const result = (await createForgeChannels({
      store,
      now: () => NOW,
      capability: async () => Promise.reject(new Error('offline')),
    }).states({ id: 'WO-1' })) as { error: string }
    expect(result.error).toBe('offline')
  })

  it('stores the operator override and keeps it', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels({ store, now: () => NOW })

    await channels.mapState({ id: 'WO-1', intent: 'in_review', optionId: 'st-progress' })
    expect((await store.load('WO-1'))?.stateMapping.in_review).toBe('st-progress')
  })

  it('puts an intent back to whatever the tracker resolves', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels({ store, now: () => NOW })

    await channels.mapState({ id: 'WO-1', intent: 'done', optionId: 'st-done' })
    await channels.mapState({ id: 'WO-1', intent: 'done', optionId: null })
    expect((await store.load('WO-1'))?.stateMapping.done).toBeNull()
  })

  it('refuses an intent that is not one of the three', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    expect(
      await createForgeChannels({ store, now: () => NOW }).mapState({
        id: 'WO-1',
        intent: 'shipped',
        optionId: 'x',
      })
    ).toEqual({ error: 'Malformed request.' })
  })

  it('reports an order it cannot find', async () => {
    const channels = createForgeChannels({ store: createOrderStore(root), now: () => NOW })
    expect(await channels.mapState({ id: 'WO-nope', intent: 'done', optionId: null })).toEqual({
      error: 'No order WO-nope.',
    })
    expect(await channels.states({ id: 'WO-nope' })).toEqual({ error: 'No order WO-nope.' })
  })

  it('rejects a malformed states request', async () => {
    const channels = createForgeChannels({ store: createOrderStore(root), now: () => NOW })
    expect(await channels.states({ nope: true })).toEqual({ error: 'Malformed request.' })
  })
})

describe('foundry:order.converge — the half that was missing', () => {
  function drafted() {
    return channels().create({
      source: { kind: 'typed', text: 'expired tokens are accepted' },
      repoPaths: [repo],
    }) as Promise<OrderView>
  }
  it('starts the architect and answers straight away, rather than holding the bridge', async () => {
    const seed = await drafted()
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 'sess-arch' }))
    const c = createForgeChannels({ store, now: () => NOW, converge })

    const r = (await c.converge({ id: seed.order.id })) as OrderView & { converging: string }
    expect(converge).toHaveBeenCalled()
    // An architect takes minutes. A channel that waited for one would hold the
    // bridge for all of them, and the surface would spin with no way to see
    // what the agent was doing.
    expect(r.converging).toBe('sess-arch')
    expect(r.order.acceptance).toEqual([])
  })

  it('names the session, so the surface can take the operator to it', async () => {
    const seed = await drafted()
    const c = createForgeChannels({
      store,
      now: () => NOW,
      converge: async () => ({ ok: true, sessionId: 'sess-arch' }),
    })
    const r = (await c.converge({ id: seed.order.id })) as { converging: string }
    expect(r.converging).toBe('sess-arch')
  })

  it('records that it started, and what it was asked', async () => {
    const seed = await drafted()
    const c = createForgeChannels({
      store,
      now: () => NOW,
      converge: async () => ({ ok: true, sessionId: 'sess-arch' }),
    })
    await c.converge({ id: seed.order.id, message: 'tighten AC-2' })
    const ledger = fs.readFileSync(path.join(root, 'orders', seed.order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('converge.started')
    expect(ledger).toContain('tighten AC-2')
  })

  it('returns the order untouched, and why, when the proposal was refused', async () => {
    const seed = await drafted()
    const c = createForgeChannels({
      store,
      now: () => NOW,
      converge: async () => ({ ok: false, reason: 'the architect could not be started' }),
    })
    const r = (await c.converge({ id: seed.order.id })) as OrderView & { error: string }
    expect(r.error).toBe('the architect could not be started')
    expect(r.order.acceptance).toEqual([])
  })

  it('records a refusal, so a run of bad proposals is visible afterwards', async () => {
    const seed = await drafted()
    const c = createForgeChannels({
      store,
      now: () => NOW,
      converge: async () => ({ ok: false, reason: 'no runtime' }),
    })
    await c.converge({ id: seed.order.id })
    const ledger = fs.readFileSync(path.join(root, 'orders', seed.order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('converge.refused')
  })

  it('says so when there is no runtime to run an architect', async () => {
    const seed = await drafted()
    const r = (await channels().converge({ id: seed.order.id })) as { error: string }
    expect(r.error).toMatch(/no architect can draft the plan/)
  })

  it('refuses to converge an order that is no longer a draft', async () => {
    const done = await agreeable()
    await store.save({ ...done, status: 'running' })
    const c = createForgeChannels({
      store,
      now: () => NOW,
      converge: async () => ({ ok: true, sessionId: 's' }),
    })
    expect(await c.converge({ id: 'WO-1' })).toEqual({
      error: 'Only a draft can be converged; this order is running.',
    })
  })

  it('reports an order it cannot find', async () => {
    const c = createForgeChannels({
      store,
      now: () => NOW,
      converge: async () => ({ ok: true, sessionId: 's' }),
    })
    expect(await c.converge({ id: 'WO-nope' })).toEqual({ error: 'No order WO-nope.' })
  })
})

describe('free text reaches the architect', () => {
  it('goes to intake rather than nowhere', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const c = createForgeChannels({ store, now: () => NOW, converge })

    await c.turn({ id: seed.order.id, message: 'the second unit is not needed' })
    expect(converge).toHaveBeenCalledWith(expect.anything(), 'the second unit is not needed')
  })

  it('leaves striking an assumption and answering a question alone', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const c = createForgeChannels({ store, now: () => NOW, converge })

    await c.turn({ id: seed.order.id, strike: seed.order.assumptions[0]?.id ?? 'A-1' })
    expect(converge).not.toHaveBeenCalled()
  })

  it('does nothing for empty text', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const c = createForgeChannels({ store, now: () => NOW, converge })

    await c.turn({ id: seed.order.id, message: '   ' })
    expect(converge).not.toHaveBeenCalled()
  })
})

describe('clearing an adversarial finding — the other thing that blocked the gate', () => {
  async function withFinding() {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    expect(seed.order.redTeam.length).toBeGreaterThan(0)
    return seed.order
  }

  it('marks one fixed', async () => {
    const o = await withFinding()
    const r = (await channels().turn({
      id: o.id,
      finding: { id: o.redTeam[0].id, decision: 'resolved' },
    })) as OrderView
    expect(r.order.redTeam[0].status).toBe('resolved')
    expect((await store.load(o.id))?.redTeam[0].status).toBe('resolved')
  })

  it('accepts one, with the reason it stands', async () => {
    const o = await withFinding()
    const r = (await channels().turn({
      id: o.id,
      finding: { id: o.redTeam[0].id, decision: 'accepted', reason: 'the risk is priced in' },
    })) as OrderView
    expect(r.order.redTeam[0]).toMatchObject({
      status: 'accepted',
      reason: 'the risk is priced in',
    })
  })

  it('refuses to accept one without a reason — a shrug is not a decision', async () => {
    const o = await withFinding()
    const r = (await channels().turn({
      id: o.id,
      finding: { id: o.redTeam[0].id, decision: 'accepted', reason: '   ' },
    })) as OrderView & { error: string }
    expect(r.error).toMatch(/costs a written reason/)
    expect(r.order.redTeam[0].status).toBe('open')
  })

  it('records who cleared it and why', async () => {
    const o = await withFinding()
    await channels().turn({
      id: o.id,
      finding: { id: o.redTeam[0].id, decision: 'accepted', reason: 'priced in' },
    })
    const ledger = fs.readFileSync(path.join(root, 'orders', o.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('finding.accepted')
    expect(ledger).toContain('priced in')
  })

  it('unblocks the compile check once every finding is cleared', async () => {
    const o = await withFinding()
    for (const finding of o.redTeam) {
      await channels().turn({ id: o.id, finding: { id: finding.id, decision: 'resolved' } })
    }
    // The one check this used to fail for ever, because nothing could clear a
    // finding.
    const compiled = (await channels().compile({ id: o.id, commit: false })) as {
      compile: { failures: { check: string }[] }
    }
    expect(compiled.compile.failures.map((f) => f.check)).not.toContain('redTeam')
  })
})

describe('accepting a criterion as unverifiable — the escape nothing could reach', () => {
  /** A draft with one criterion whose proof is a command that does not exist. */
  async function withCriterion() {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const order = seed.order
    const withAc: WorkOrder = {
      ...order,
      acceptance: [
        {
          id: 'AC-1',
          statement: 'the row does not clip its last glyph',
          priority: 'P0',
          verify: { kind: 'screenshot', target: 'the terminal row' },
          unverifiable: null,
        },
      ],
    }
    await store.save(withAc)
    return withAc
  }

  it('records the acceptance on the criterion, with the reason', async () => {
    const o = await withCriterion()
    const r = (await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: 'no display in this environment' },
    })) as OrderView
    expect(r.order.acceptance[0].unverifiable).toEqual({
      accepted: true,
      reason: 'no display in this environment',
    })
    expect((await store.load(o.id))?.acceptance[0].unverifiable?.accepted).toBe(true)
  })

  it('says which part of the document moved, so the operator sees the redraw', async () => {
    const o = await withCriterion()
    const r = (await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: 'nothing here can run it' },
    })) as OrderView
    expect(r.changed).toContain('acceptance')
  })

  it('refuses one without a reason — the same shrug the finding refuses', async () => {
    const o = await withCriterion()
    const r = (await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: '   ' },
    })) as OrderView & { error: string }
    expect(r.error).toMatch(/costs a reason/)
    expect(r.order.acceptance[0].unverifiable).toBeNull()
  })

  it('refuses a criterion this order does not have', async () => {
    const o = await withCriterion()
    const r = (await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-9', reason: 'because' },
    })) as OrderView & { error: string }
    expect(r.error).toMatch(/No criterion AC-9/)
  })

  it('records who accepted it and why', async () => {
    const o = await withCriterion()
    await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: 'no display in this environment' },
    })
    const ledger = fs.readFileSync(path.join(root, 'orders', o.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('criterion.unverifiable')
    expect(ledger).toContain('no display in this environment')
  })

  it('clears the falsifiable check, which is the whole point of the escape', async () => {
    const o = await withCriterion()
    // The failure an operator actually meets: a unit changes a file a person
    // looks at, and no criterion asks for a picture of it. The other half of
    // this check — a criterion with no proof at all — cannot survive the
    // schema, so this is the one the escape has to answer.
    const blocked: WorkOrder = {
      ...o,
      acceptance: [
        { ...o.acceptance[0], verify: { kind: 'command', command: 'npm test', assert: 'ok' } },
      ],
      plan: {
        ...o.plan,
        units: [
          {
            id: 'U-1',
            title: 'redraw the row',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['src/components/Row.tsx'],
            verify: [],
          },
        ],
      },
    }
    await store.save(blocked)

    const before = (await channels().compile({ id: o.id, commit: false })) as {
      compile: { failures: { check: string }[] }
    }
    expect(before.compile.failures.map((f) => f.check)).toContain('verifiable')

    await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: 'there is no display in this environment' },
    })

    const after = (await channels().compile({ id: o.id, commit: false })) as {
      compile: { failures: { check: string }[] }
    }
    expect(after.compile.failures.map((f) => f.check)).not.toContain('verifiable')
  })
})

describe('turning a write-back off for one order (FR-062)', () => {
  it('keeps what the operator chose', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const r = (await channels().setWriteBack({
      id: seed.order.id,
      writeBack: ['summary_comment'],
    })) as OrderView

    expect(r.order.writeBack).toEqual(['summary_comment'])
    expect((await store.load(seed.order.id))?.writeBack).toEqual(['summary_comment'])
  })

  it('takes none at all', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const r = (await channels().setWriteBack({ id: seed.order.id, writeBack: [] })) as OrderView
    expect(r.order.writeBack).toEqual([])
  })

  it('records the choice, and says what it means when it is nothing', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    await channels().setWriteBack({ id: seed.order.id, writeBack: [] })
    const ledger = fs.readFileSync(path.join(root, 'orders', seed.order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('writeback.configured')
    expect(ledger).toContain('nothing is written back')
  })

  it('refuses a write-back this build does not have', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    expect(await channels().setWriteBack({ id: seed.order.id, writeBack: ['everything'] })).toEqual(
      { error: 'Malformed request.' }
    )
  })

  it('reports an order it cannot find', async () => {
    expect(await channels().setWriteBack({ id: 'WO-nope', writeBack: [] })).toEqual({
      error: 'No order WO-nope.',
    })
  })
})

// A setting that reaches nothing is a control the operator can move while the
// factory ignores it. Both of these were registered and read by nobody: every
// order got 3 agents / 45 minutes / 25 files regardless, and a critical path
// the operator declared never made it onto an order's risk.

describe('what configuration a new order starts with', () => {
  async function seeded(deps: Partial<Parameters<typeof createForgeChannels>[0]>) {
    const c = createForgeChannels({ store, now: () => NOW, ...deps })
    return (await c.create({
      source: { kind: 'typed', text: 'change the session refresh' },
      repoPaths: [repo],
    })) as OrderView
  }

  it('takes the budgets the operator configured (FR-030)', async () => {
    const r = await seeded({
      budgetDefaults: () => ({ agents: 1, wallClockMinutes: 10, filesTouched: 4 }),
    })
    expect(r.order.budgets).toMatchObject({ agents: 1, wallClockMinutes: 10, filesTouched: 4 })
  })

  it('falls back to the schema defaults when nothing is configured', async () => {
    const r = await seeded({})
    expect(r.order.budgets).toMatchObject({ agents: 3, wallClockMinutes: 45, filesTouched: 25 })
  })

  it('reads the budgets on every order, not once when the extension started', async () => {
    let agents = 1
    const c = createForgeChannels({
      store,
      now: () => NOW,
      budgetDefaults: () => ({ agents, wallClockMinutes: 45, filesTouched: 25 }),
    })
    const first = (await c.create({
      source: { kind: 'typed', text: 'first' },
      repoPaths: [repo],
    })) as OrderView
    agents = 5
    const second = (await c.create({
      source: { kind: 'typed', text: 'second' },
      repoPaths: [repo],
    })) as OrderView
    expect(first.order.budgets.agents).toBe(1)
    expect(second.order.budgets.agents).toBe(5)
  })

  it("carries the operator's declared critical paths onto the order's risk (FR-043)", async () => {
    const r = await seeded({ criticalPaths: () => ['src/main/auth/**', 'src/main/billing/**'] })
    expect(r.order.risk.criticalPaths).toEqual(['src/main/auth/**', 'src/main/billing/**'])
  })

  it('declares none when the operator declared none — never inferred', async () => {
    const r = await seeded({})
    expect(r.order.risk.criticalPaths).toEqual([])
  })
})

// A ticket that states its acceptance criteria, taken at its word. The
// description arrived whole in `intent.problem` and nothing read it, so an
// order seeded from a ticket with a heading literally called "Acceptance
// Criteria" opened saying "No criteria yet" to the person who had just
// written them.
describe('an order seeded from a ticket that states its criteria', () => {
  const DESCRIPTION = [
    '# Summary',
    'Make all text in the application red',
    '',
    '# Acceptance Criteria',
    '- [ ] All text in the application is red',
    '- [ ] The heading is red too',
  ].join('\n')

  const issue = () =>
    vi.fn(async () => ({
      key: 'TAV-14',
      title: 'Make all text in the application red',
      description: DESCRIPTION,
      url: 'https://linear.app/x/TAV-14',
      branchName: null,
    }))

  it('starts from the criteria the ticket already stated', async () => {
    const r = (await channels(issue()).create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-14' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.acceptance.map((c) => c.statement)).toEqual([
      'All text in the application is red',
      'The heading is red too',
    ])
  })

  it('still needs a plan, because coverage runs both ways', async () => {
    // The point of the guard: lifting criteria must not let an order hand off
    // without the architect. A criterion no unit satisfies fails the compile
    // exactly as an order with no criteria at all did.
    const r = (await channels(issue()).create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-14' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.compile.ok).toBe(false)
    expect(r.order.plan.units).toEqual([])
  })

  it('keeps the description whole as well, so nothing is lost in the lifting', async () => {
    const r = (await channels(issue()).create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-14' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.intent.problem).toContain('# Dev Hints'.slice(0, 1))
    expect(r.order.intent.problem).toContain('# Summary')
  })

  it('takes nothing from a ticket that states nothing', async () => {
    const bare = vi.fn(async () => ({
      key: 'TAV-15',
      title: 'Something',
      description: 'Just do the thing.',
      url: '',
      branchName: null,
    }))
    const r = (await channels(bare).create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-15' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.acceptance).toEqual([])
  })
})
