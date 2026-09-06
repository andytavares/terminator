import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createForgeChannels } from '../../src/ipc/forge-channels.js'
import { createOrderStore } from '../../src/order/store.js'
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
            touches: ['src/a.css'],
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
