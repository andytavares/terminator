import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createOrderStore, createLiveOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { makeTempDir } from '../../../../packages/test-support/src/temp-dir'

let root: string

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-0913-c71',
      title: 'Terminal clips the last glyph',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    }),
    ...over,
  }
}

beforeEach(() => {
  root = makeTempDir('foundry-store-')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createOrderStore', () => {
  describe('atomic saves', atomicSavesTests)
  describe('the rendering', theRenderingTests)
  describe('missing and corrupt orders', missingAndCorruptOrdersTests)
  describe('listing', storeListingTests)
  describe('finding by issue', findingByIssueTests)
  describe('trackers and the ledger', trackersAndTheLedgerTests)
  describe('updates made at once', concurrentUpdateTests)
  describe('an update', updateResultTests)
})

// A stop that cancelled the order was once written over by a run saving the copy it loaded
// when it started: the order came back `running`.
function concurrentUpdateTests() {
  it('keeps both of two updates made at once: neither works from a stale copy', async () => {
    const store = createOrderStore(root)
    await store.save(order({ status: 'running' }))
    await Promise.all([
      store.update('WO-0913-c71', (o) => ({ ...o, title: 'Renamed while running' })),
      store.update('WO-0913-c71', (o) => ({ ...o, status: 'cancelled' })),
    ])
    expect(await store.load('WO-0913-c71')).toMatchObject({
      status: 'cancelled',
      title: 'Renamed while running',
    })
  })

  it('serialises updates across stores that resolve the same root', async () => {
    await createOrderStore(root).save(order({ status: 'running' }))
    const renaming = createLiveOrderStore(() => root)
    const cancelling = createLiveOrderStore(() => root)
    await Promise.all([
      renaming.update('WO-0913-c71', (o) => ({ ...o, title: 'Renamed while running' })),
      cancelling.update('WO-0913-c71', (o) => ({ ...o, status: 'cancelled' })),
    ])
    expect(await createOrderStore(root).load('WO-0913-c71')).toMatchObject({
      status: 'cancelled',
      title: 'Renamed while running',
    })
  })
}

function updateResultTests() {
  it('returns the order as saved, and null for one that does not exist', async () => {
    const store = createOrderStore(root)
    await store.save(order())
    expect(await store.update('WO-0913-c71', (o) => ({ ...o, title: 'B' }))).toMatchObject({
      title: 'B',
    })
    expect(await store.update('WO-missing', (o) => o)).toBeNull()
  })
}

function atomicSavesTests() {
  it('never shows a reader a half-written order while it is being saved', async () => {
    const store = createOrderStore(root)
    await store.save(order())
    const seen: (WorkOrder | null)[] = []
    // Saved in place, five reads in six land in the gap, from the first round
    // on; twenty rounds catch that every time without 200 rounds of disk work.
    for (let i = 0; i < 20; i++) {
      const [, loaded] = await Promise.all([
        store.save(order({ title: `Save ${i}` })),
        store.load('WO-0913-c71'),
      ])
      seen.push(loaded)
    }
    expect(seen.filter((o) => o === null)).toHaveLength(0)
  })
}

function theRenderingTests() {
  it('writes the truth and its rendering side by side', async () => {
    const store = createOrderStore(root)
    await store.save(order())
    const dir = path.join(root, 'orders', 'WO-0913-c71')
    expect(fs.existsSync(path.join(dir, 'order.json'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'order.md'), 'utf8')).toContain(
      '# Terminal clips the last glyph'
    )
  })

  it('reads back exactly what it wrote', async () => {
    const store = createOrderStore(root)
    const saved = order()
    await store.save(saved)
    expect(await store.load('WO-0913-c71')).toEqual(saved)
  })

  it('regenerates the rendering on every save rather than leaving it stale', async () => {
    const store = createOrderStore(root)
    await store.save(order())
    await store.save(order({ title: 'A different title' }))
    expect(fs.readFileSync(path.join(root, 'orders', 'WO-0913-c71', 'order.md'), 'utf8')).toContain(
      'A different title'
    )
  })
}

function missingAndCorruptOrdersTests() {
  it('returns null for an order that does not exist', async () => {
    expect(await createOrderStore(root).load('WO-nope')).toBeNull()
  })

  it('returns null for a corrupt order rather than throwing', async () => {
    const dir = path.join(root, 'orders', 'WO-bad')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'order.json'), '{{{')
    expect(await createOrderStore(root).load('WO-bad')).toBeNull()
  })
}

function storeListingTests() {
  it('lists orders newest first', async () => {
    const store = createOrderStore(root)
    await store.save(order({ id: 'WO-1', createdAt: '2026-09-01T10:00:00.000Z' }))
    await store.save(order({ id: 'WO-2', createdAt: '2026-09-05T10:00:00.000Z' }))
    expect((await store.list()).map((o) => o.id)).toEqual(['WO-2', 'WO-1'])
  })

  it('lists nothing before any order exists', async () => {
    expect(await createOrderStore(root).list()).toEqual([])
  })

  it('skips a corrupt order without losing the rest', async () => {
    const store = createOrderStore(root)
    await store.save(order({ id: 'WO-good' }))
    const bad = path.join(root, 'orders', 'WO-bad')
    fs.mkdirSync(bad, { recursive: true })
    fs.writeFileSync(path.join(bad, 'order.json'), 'not json')
    expect((await store.list()).map((o) => o.id)).toEqual(['WO-good'])
  })
}

function findingByIssueTests() {
  it('finds an open order already seeded from an issue', async () => {
    const store = createOrderStore(root)
    await store.save(
      order({
        id: 'WO-tav',
        source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42', url: 'u' },
      })
    )
    expect(await store.findByIssue('linear', 'TAV-42')).toEqual({
      id: 'WO-tav',
      title: 'Terminal clips the last glyph',
    })
  })

  it('does not offer a shipped order when the same issue is seeded again', async () => {
    const store = createOrderStore(root)
    await store.save(
      order({
        id: 'WO-tav',
        status: 'shipped',
        source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42', url: 'u' },
      })
    )
    expect(await store.findByIssue('linear', 'TAV-42')).toBeNull()
  })
}

function trackersAndTheLedgerTests() {
  it('does not find an order for a key it was not made from', async () => {
    const store = createOrderStore(root)
    await store.save(
      order({ id: 'WO-l', source: { kind: 'tracker', tracker: 'linear', key: 'X-1', url: 'u' } })
    )
    expect(await store.findByIssue('linear', 'X-2')).toBeNull()
  })

  it('appends a decision to that order own ledger', async () => {
    const store = createOrderStore(root)
    await store.record({
      at: '2026-09-06T10:00:00.000Z',
      orderId: 'WO-0913-c71',
      actor: 'operator',
      action: 'order.agreed',
      subject: 'WO-0913-c71',
      reason: 'all six checks pass',
      evidence: [],
    })
    const ledger = path.join(root, 'orders', 'WO-0913-c71', 'ledger.jsonl')
    expect(JSON.parse(fs.readFileSync(ledger, 'utf8').trim()).action).toBe('order.agreed')
  })
}

describe('a store whose root follows the workspace', () => {
  describe('writing', storeWritingTests)
  describe('reading through the resolver', readingThroughTheResolverTests)
  describe('the ledger', storeTheLedgerTests)
})

function storeWritingTests() {
  it('writes wherever the resolver points, on each call', async () => {
    const a = path.join(root, 'a')
    const b = path.join(root, 'b')
    let here = a
    const store = createLiveOrderStore(() => here)

    await store.save(order({ id: 'WO-A' }))
    here = b
    await store.save(order({ id: 'WO-B' }))

    // Resolved on every call, because activation runs before a workspace
    // exists and pinning the answer there sent every order to one place.
    expect((await createOrderStore(a).list()).map((o) => o.id)).toEqual(['WO-A'])
    expect((await createOrderStore(b).list()).map((o) => o.id)).toEqual(['WO-B'])
  })
}

function readingThroughTheResolverTests() {
  // `createLiveOrderStore` passes each call through to a store at the resolved root.
  it('reads through the resolver what a store at that root wrote', async () => {
    const saved = order({ id: 'WO-1' })
    await createOrderStore(root).save(saved)
    expect(await createLiveOrderStore(() => root).load('WO-1')).toEqual(saved)
  })
}

function storeTheLedgerTests() {
  // Some of what happens to an order is recorded here and nowhere else — an
  // intake turn whose proposal was refused writes a line and never touches
  // `order.json` — so a store that could only append was a store no surface
  // could ask what had happened.
  it('reads back the ledger it wrote, oldest first', async () => {
    const store = createOrderStore(root)
    const line = {
      at: '2026-09-09T19:33:00.000Z',
      orderId: 'WO-9',
      actor: 'role:architect',
      subject: 'WO-9',
      evidence: [],
    }
    await store.record({ ...line, action: 'converge.started', reason: '' })
    await store.record({ ...line, action: 'converge.refused', reason: 'Invalid enum value.' })

    const entries = await store.entries('WO-9')
    expect(entries.map((e) => [e.action, e.reason])).toEqual([
      ['converge.started', ''],
      ['converge.refused', 'Invalid enum value.'],
    ])
  })

  // An order nothing has happened to yet is not an error.
  it('reads an empty ledger as no entries', async () => {
    expect(await createOrderStore(root).entries('WO-nothing')).toEqual([])
  })
}
