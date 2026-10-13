import { createOrderStore } from '../order/store.js'
import { createGateStore } from '../gates/store.js'
import { readRunGraph } from '../ipc/run-channels.js'
import type { IndexSource } from './foundry-index.js'

/** What an index loads from: the store modules with no index, so a load parses disk. */
export function diskSourceFor(root: string): IndexSource {
  return {
    orders: () => createOrderStore(root).list(),
    gates: () => createGateStore(root).list(),
    graph: (orderId) => readRunGraph(root, orderId),
    ledger: (orderId) => createOrderStore(root).entries(orderId),
  }
}
