import type { ExtensionAPI } from '@terminator/extension-sdk'

import { writeRunGraph, readRunGraph } from '../ipc/run-channels.js'
import { createFoundryIndexes } from './foundry-index.js'
import type { FoundryIndex, FoundryIndexes } from './foundry-index.js'
import { diskSourceFor } from './disk-source.js'
import { createGateStore } from '../gates/store.js'
import { createOrderStore } from '../order/store.js'
import type { RunGraph } from '../line/run-graph.js'
import { computeQueueEntries } from '../line/refinery-entries.js'
import type { QueueEntry } from '../line/refinery.js'

// One in-memory index per data root, behind every store call below. Activation swaps
// in one that broadcasts `foundry:changed`; until then a change goes nowhere, as a call
// outside a running extension wants.
let indexes: FoundryIndexes = createFoundryIndexes(diskSourceFor, () => {})

// A change only this process knows (a held call, a stall, a running or stranded agent,
// an open intake), told to the windows directly. `orderId` is empty for no one order.
export function announceLive(orderId: string): void {
  indexes.announce({ kind: 'live', orderId })
}

export function indexFor(root: string): FoundryIndex {
  return indexes.forRoot(root)
}

export const orderStoreAt = (root: string): ReturnType<typeof createOrderStore> =>
  createOrderStore(root, indexFor(root))
export const gateStoreAt = (root: string): ReturnType<typeof createGateStore> =>
  createGateStore(root, indexFor(root))
export const readGraph = (root: string, orderId: string): ReturnType<typeof readRunGraph> =>
  readRunGraph(root, orderId, indexFor(root))
export const writeGraph = (root: string, graph: RunGraph): Promise<void> =>
  writeRunGraph(root, graph, indexFor(root))

/** The refinery queue, read afresh each call from wherever the records are then. */
export function queueEntriesOf(root: () => string): () => Promise<QueueEntry[]> {
  return () => computeQueueEntries(root(), orderStoreAt(root()))
}

/** Replace the index with one that tells every window, and `onChange`, what changed. */
export function connectIndexes(api: ExtensionAPI, onChange: () => void = () => {}): void {
  indexes = createFoundryIndexes(diskSourceFor, (change) => {
    onChange()
    try {
      api.window.broadcast('foundry:changed', change)
    } catch (error) {
      // The write that caused this already succeeded; a window that cannot be
      // told is not a reason to fail it.
      api.log.error('foundry:changed could not be broadcast', error)
    }
  })
}
