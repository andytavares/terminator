import { describe, it, expect, vi } from 'vitest'
import { createFoundryIndexes } from '../../src/state/foundry-index.js'
import type { FoundryChange, IndexSource } from '../../src/state/foundry-index.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Gate } from '../../src/gates/rules.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import { partialFake } from '../../../../tests/support/fakes'
import { emptyRunGraph } from '../helpers/run-nodes.js'

function listedOrder(id: string, createdAt: string): WorkOrder {
  return partialFake<WorkOrder>({ id, createdAt, title: id, status: 'agreed' })
}
function pendingGate(id: string, orderId: string): Gate {
  return partialFake<Gate>({ id, orderId, rule: 'ready-for-review', decision: null })
}
function operatorEntry(orderId: string, action: string): LedgerEntry {
  return {
    at: '2026-01-01T00:00:00Z',
    orderId,
    actor: 'operator',
    action,
    subject: '',
    reason: '',
    evidence: [],
  }
}
function disk(): IndexSource & { reads: Record<string, number> } {
  const reads = { orders: 0, gates: 0, graph: 0, ledger: 0 }
  return {
    reads,
    orders: async () => (reads.orders++, [listedOrder('WO-1', '2026-01-01')]),
    gates: async () => (reads.gates++, [pendingGate('g1', 'WO-1')]),
    graph: async () => (reads.graph++, null),
    ledger: async () => (reads.ledger++, [operatorEntry('WO-1', 'first')]),
  }
}

function indexOverFakeDisk() {
  const source = disk()
  const changes: FoundryChange[] = []
  const indexes = createFoundryIndexes(
    () => source,
    (change) => changes.push(change)
  )
  return { source, changes, index: indexes.forRoot('/data') }
}

describe('the Foundry index', () => {
  describe('reading from disk', readingFromDiskTests)
  describe('orders', ordersTests)
  describe('gates', foundryIndexGatesTests)
  describe('ledgers', ledgersTests)
  describe('graphs and resets', graphsAndResetsTests)
  describe('deletion, roots and live changes', deletionRootsAndLiveChangesTests)
})

function readingFromDiskTests() {
  it('reads from disk again after a failed read instead of keeping the failure', async () => {
    const read = disk()
    let fail = true
    const source = {
      ...read,
      orders: async () => {
        if (fail) throw new Error('disk unavailable')
        return read.orders()
      },
    }
    const index = createFoundryIndexes(
      () => source,
      () => {}
    ).forRoot('/data')

    await expect(index.orders()).rejects.toThrow('disk unavailable')
    fail = false
    expect((await index.orders()).map((o) => o.id)).toEqual(['WO-1'])
  })

  it('reads each kind from disk once and then answers from memory', async () => {
    const { source, index } = indexOverFakeDisk()
    for (let i = 0; i < 3; i++) {
      await index.orders()
      await index.gates()
      await index.ledger('WO-1')
      await index.graph('WO-1')
    }
    expect(source.reads).toEqual({ orders: 1, gates: 1, graph: 1, ledger: 1 })
  })
}

function ordersTests() {
  it('shares one load between concurrent first readers', async () => {
    const { source, index } = indexOverFakeDisk()
    await Promise.all([index.orders(), index.orders(), index.order('WO-1')])
    expect(source.reads.orders).toBe(1)
  })

  it('returns a saved order, newest first, and says an order changed', async () => {
    const { index, changes } = indexOverFakeDisk()
    await index.orders()
    index.orderSaved(listedOrder('WO-2', '2026-02-01'))
    expect((await index.orders()).map((o) => o.id)).toEqual(['WO-2', 'WO-1'])
    expect((await index.order('WO-2'))?.title).toBe('WO-2')
    expect(changes).toEqual([{ kind: 'order', orderId: 'WO-2' }])
  })

  it('answers null for an order that is not there', async () => {
    const { index } = indexOverFakeDisk()
    expect(await index.order('WO-9')).toBeNull()
  })

  it('hands out copies, so a caller changing one cannot change the index', async () => {
    const { index } = indexOverFakeDisk()
    const first = await index.order('WO-1')
    ;(first as { title: string }).title = 'changed'
    expect((await index.order('WO-1'))?.title).toBe('WO-1')
  })
}

function foundryIndexGatesTests() {
  it('replaces the gates of one order and announces the order they belong to', async () => {
    const { index, changes } = indexOverFakeDisk()
    await index.gates()
    index.gatesWritten('WO-1', [pendingGate('g1', 'WO-1'), pendingGate('g2', 'WO-1')])
    index.gatesWritten('WO-2', [pendingGate('g3', 'WO-2')])
    expect((await index.gates()).map((g) => g.id)).toEqual(['g1', 'g2', 'g3'])
    expect((await index.gatesOf('WO-1')).map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(changes).toEqual([
      { kind: 'gates', orderId: 'WO-1' },
      { kind: 'gates', orderId: 'WO-2' },
    ])
  })
}

function ledgersTests() {
  it('appends a ledger entry to a loaded ledger and announces it', async () => {
    const { index, changes } = indexOverFakeDisk()
    await index.ledger('WO-1')
    index.entryAppended(operatorEntry('WO-1', 'second'))
    expect((await index.ledger('WO-1')).map((e) => e.action)).toEqual(['first', 'second'])
    expect(changes).toEqual([{ kind: 'ledger', orderId: 'WO-1' }])
  })

  it('does not double-count an entry written while the ledger was still loading', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    // The disk read has already seen the entry that the write below reports.
    const source = {
      ...disk(),
      ledger: async () => {
        await held
        return [operatorEntry('WO-1', 'first'), operatorEntry('WO-1', 'second')]
      },
    }
    const index = createFoundryIndexes(() => source, vi.fn()).forRoot('/data')
    const loading = index.ledger('WO-1')
    index.entryAppended(operatorEntry('WO-1', 'second'))
    release()
    await loading
    expect((await index.ledger('WO-1')).map((e) => e.action)).toEqual(['first', 'second'])
  })
}

function graphsAndResetsTests() {
  it('keeps a written graph and announces it', async () => {
    const { index, changes } = indexOverFakeDisk()
    expect(await index.graph('WO-1')).toBeNull()
    index.graphSaved(emptyRunGraph('WO-1'))
    expect((await index.graph('WO-1'))?.orderId).toBe('WO-1')
    expect(changes).toEqual([{ kind: 'graph', orderId: 'WO-1' }])
  })

  it('forgets a run reset: graph and gates are gone, the order and ledger stay', async () => {
    const { index, changes } = indexOverFakeDisk()
    await index.gates()
    index.graphSaved(emptyRunGraph('WO-1'))
    index.gatesWritten('WO-1', [pendingGate('g1', 'WO-1')])
    await index.orders()
    index.runReset('WO-1')
    expect(await index.graph('WO-1')).toBeNull()
    expect(await index.gatesOf('WO-1')).toEqual([])
    expect((await index.orders()).map((o) => o.id)).toEqual(['WO-1'])
    expect(changes.slice(-2)).toEqual([
      { kind: 'graph', orderId: 'WO-1' },
      { kind: 'gates', orderId: 'WO-1' },
    ])
  })
}

function deletionRootsAndLiveChangesTests() {
  it('forgets a deleted order everywhere', async () => {
    const { index } = indexOverFakeDisk()
    await index.orders()
    await index.gates()
    await index.ledger('WO-1')
    index.orderRemoved('WO-1')
    expect(await index.order('WO-1')).toBeNull()
    expect(await index.gates()).toEqual([])
    expect(await index.ledger('WO-1')).toEqual([])
  })

  it('keeps one index per data root, so a workspace switch does not mix records', () => {
    const indexes = createFoundryIndexes(() => disk(), vi.fn())
    expect(indexes.forRoot('/a')).toBe(indexes.forRoot('/a'))
    expect(indexes.forRoot('/a')).not.toBe(indexes.forRoot('/b'))
  })

  it('announces a live change that has no file behind it', () => {
    const changes: FoundryChange[] = []
    const indexes = createFoundryIndexes(
      () => disk(),
      (change) => changes.push(change)
    )
    indexes.announce({ kind: 'live', orderId: '' })
    expect(changes).toEqual([{ kind: 'live', orderId: '' }])
  })
}
