import type { ExtensionAPI } from '@terminator/extension-sdk'

import { writeRunGraph, readRunGraph } from '../ipc/run-channels.js'
import { createFoundryIndexes } from './foundry-index.js'
import type { FoundryIndex, FoundryIndexes } from './foundry-index.js'
import { diskSourceFor } from './disk-source.js'
import { createGateStore } from '../gates/store.js'
import { createOrderStore } from '../order/store.js'
import type { RunGraph } from '../line/run-graph.js'

/**
 * What Foundry holds of its own records in memory, one index per data root.
 *
 * Every store call below goes through it, so a write reaches disk first and
 * the index second, and a read after that is a lookup. Replaced on activation
 * with one that tells the windows (`foundry:changed`); until then a change
 * goes nowhere, which is what a call made outside a running extension wants.
 */
let indexes: FoundryIndexes = createFoundryIndexes(diskSourceFor, () => {})

/**
 * Something only this process knows has changed — a held tool call, a stall, a
 * running or stranded agent, an open intake — and a standing is drawn from it.
 * No file records these, so the windows are told directly. `orderId` is empty
 * when the change is not tied to one order.
 */
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

/** Replace the index with one that tells every window what changed. */
export function connectIndexes(api: ExtensionAPI): void {
  indexes = createFoundryIndexes(diskSourceFor, (change) => {
    try {
      api.window.broadcast('foundry:changed', change)
    } catch (error) {
      // The write that caused this already succeeded; a window that cannot be
      // told is not a reason to fail it.
      api.log.error('foundry:changed could not be broadcast', error)
    }
  })
}
