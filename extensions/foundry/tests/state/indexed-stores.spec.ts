import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import { createFoundryIndexes } from '../../src/state/foundry-index.js'
import type { FoundryChange } from '../../src/state/foundry-index.js'
import { diskSourceFor } from '../../src/state/disk-source.js'
import { createOrderStore } from '../../src/order/store.js'
import { createGateStore } from '../../src/gates/store.js'
import { readRunGraph, writeRunGraph } from '../../src/ipc/run-channels.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Gate } from '../../src/gates/rules.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'
import { partialFake } from '../../../../tests/support/fakes'

// The store modules and the index together, on real files: what a write left
// on disk is what the index answers with, and the windows are told which order
// and which kind of record changed.

let root: string
let changes: FoundryChange[]

function indexOver(directory: string) {
  return createFoundryIndexes(diskSourceFor, (change) => changes.push(change)).forRoot(directory)
}

function order(id: string, createdAt = '2026-09-06T10:00:00.000Z'): WorkOrder {
  return draftOrder({
    id,
    title: `Order ${id}`,
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: createdAt,
  })
}

function gate(id: string, orderId: string): Gate {
  return partialFake<Gate>({
    id,
    rule: 'budget.exceeded',
    orderId,
    summary: 's',
    why: 'w',
    evidence: [],
    raisedAt: '2026-09-06T10:00:00.000Z',
    decision: null,
    breach: null,
  })
}

function graph(orderId: string): RunGraph {
  return partialFake<RunGraph>({ orderId, recipe: 'direct', nodes: [] })
}

beforeEach(() => {
  root = makeTempDir('fdry-index-')
  changes = []
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('orders through the index', () => {
  describe('listing and reading', listingAndReadingTests)
  describe('loading', indexedStoresLoadingTests)
})

function listingAndReadingTests() {
  it('lists what was saved, newest first, and names the order that changed', async () => {
    const store = createOrderStore(root, indexOver(root))
    await store.save(order('WO-1', '2026-09-06T10:00:00.000Z'))
    await store.save(order('WO-2', '2026-09-07T10:00:00.000Z'))
    expect((await store.list()).map((o) => o.id)).toEqual(['WO-2', 'WO-1'])
    expect(changes).toEqual([
      { kind: 'order', orderId: 'WO-1' },
      { kind: 'order', orderId: 'WO-2' },
    ])
  })

  it('answers exactly what a fresh read of the same disk answers', async () => {
    const store = createOrderStore(root, indexOver(root))
    await store.save(order('WO-1'))
    const fromDisk = await createOrderStore(root).load('WO-1')
    expect(await store.load('WO-1')).toEqual(fromDisk)
  })
}

function indexedStoresLoadingTests() {
  it('does not read an order file again once it has been loaded', async () => {
    const store = createOrderStore(root, indexOver(root))
    await store.save(order('WO-1'))
    await store.list()
    const read = vi.spyOn(fs.promises, 'readFile')
    await store.list()
    await store.load('WO-1')
    expect(read).not.toHaveBeenCalled()
  })

  it('loads from disk the first time, so orders from an earlier session are there', async () => {
    await createOrderStore(root).save(order('WO-1'))
    const store = createOrderStore(root, indexOver(root))
    expect((await store.list()).map((o) => o.id)).toEqual(['WO-1'])
  })

  it('finds an open order by its issue from memory', async () => {
    const store = createOrderStore(root, indexOver(root))
    const seeded = {
      ...order('WO-1'),
      source: { kind: 'tracker', tracker: 'linear', key: 'ENG-1', url: null },
    } as WorkOrder
    await store.save(seeded)
    expect(await store.findByIssue('linear', 'ENG-1')).toEqual({ id: 'WO-1', title: 'Order WO-1' })
  })
}

describe('ledgers through the index', () => {
  describe('an appended entry', anAppendedEntryTests)
  describe('an entry with no actor', anEntryWithNoActorTests)
})

function anAppendedEntryTests() {
  it('reads back an appended entry and names the order whose ledger grew', async () => {
    const store = createOrderStore(root, indexOver(root))
    await store.entries('WO-1')
    await store.record({
      at: '2026-09-06T10:00:00.000Z',
      orderId: 'WO-1',
      actor: 'operator',
      action: 'order.agreed',
      subject: 'WO-1',
      reason: 'ok',
      evidence: [],
    })
    expect((await store.entries('WO-1')).map((e) => e.action)).toEqual(['order.agreed'])
    expect(changes).toEqual([{ kind: 'ledger', orderId: 'WO-1' }])
  })
}

function anEntryWithNoActorTests() {
  it('still refuses an entry with no actor, and announces nothing for it', async () => {
    const store = createOrderStore(root, indexOver(root))
    await expect(
      store.record({
        at: 'x',
        orderId: 'WO-1',
        actor: ' ',
        action: 'a',
        subject: '',
        reason: '',
        evidence: [],
      })
    ).rejects.toThrow()
    expect(changes).toEqual([])
  })
}

describe('gates through the index', () => {
  it('lists a saved gate and names the order it belongs to', async () => {
    const store = createGateStore(root, indexOver(root))
    await store.list()
    await store.save(gate('g1', 'WO-1'))
    await store.save({ ...gate('g1', 'WO-1'), summary: 'changed' })
    await store.save(gate('g2', 'WO-2'))
    const listed = await store.list()
    expect(listed.map((g) => [g.id, g.summary])).toEqual([
      ['g1', 'changed'],
      ['g2', 's'],
    ])
    expect((await store.get('g2'))?.orderId).toBe('WO-2')
    expect(changes.map((c) => c.orderId)).toEqual(['WO-1', 'WO-1', 'WO-2'])
    expect(new Set(changes.map((c) => c.kind))).toEqual(new Set(['gates']))
  })

  it('answers what a fresh read of the same disk answers', async () => {
    const store = createGateStore(root, indexOver(root))
    await store.save(gate('g1', 'WO-1'))
    expect(await store.list()).toEqual(await createGateStore(root).list())
  })
})

describe('run graphs through the index', () => {
  it('reads back a written graph and names the order whose run moved', async () => {
    const index = indexOver(root)
    await writeRunGraph(root, graph('WO-1'), index)
    expect((await readRunGraph(root, 'WO-1', index))?.orderId).toBe('WO-1')
    expect(changes).toEqual([{ kind: 'graph', orderId: 'WO-1' }])
  })

  it('does not read the graph file again once it is known', async () => {
    const index = indexOver(root)
    await writeRunGraph(root, graph('WO-1'), index)
    const read = vi.spyOn(fs.promises, 'readFile')
    await readRunGraph(root, 'WO-1', index)
    expect(read).not.toHaveBeenCalled()
  })

  it('answers what a fresh read of the same disk answers', async () => {
    const index = indexOver(root)
    await writeRunGraph(root, graph('WO-1'), index)
    expect(await readRunGraph(root, 'WO-1', index)).toEqual(await readRunGraph(root, 'WO-1'))
  })
})
