import * as path from 'node:path'

import { orphanedNodes } from '../line/reclaim.js'
import type { StandingSources } from '../order/standing.js'
import type { WaitingOrder } from '../gates/attention.js'
import { createLiveOrderStore } from '../order/store.js'
import { lastIntake } from '../forge/intake-outcome.js'
import { orderStandingSources } from '../order/order-standing-sources.js'
import { readStanding } from '../order/standing.js'
import type { WorkOrder } from '../order/schema.js'

import { indexFor, orderStoreAt, readGraph } from '../state/live-index.js'
import {
  pendingPermissions,
  stallFirings,
  strandedAgents,
  isLiveSession,
} from '../runtime/runtime-state.js'
import { executingOrders } from '../line/run-control.js'

/** The sources a standing is drawn from that only this process can answer. */
export type LiveStandingSources = Required<
  Pick<
    StandingSources,
    'graphFor' | 'shapingFor' | 'gatesFor' | 'asksFor' | 'stallsFor' | 'strandedFor' | 'orphansFor'
  >
>

/** Orders whose turn just ended and whose next step is still being chosen. */
export interface Deciding {
  readonly has: (orderId: string) => boolean
  readonly during: (orderId: string, work: () => Promise<void>) => Promise<void>
}

// Orders whose turn just ended and whose next step is still being chosen.
// The ledger cannot say so: between `order.redrafted` and whatever starts
// next there is no line, and a draft read in that gap looked idle.
export function createDeciding(): Deciding {
  const deciding = new Map<string, number>()
  const whileDeciding = async (orderId: string, work: () => Promise<void>): Promise<void> => {
    deciding.set(orderId, (deciding.get(orderId) ?? 0) + 1)
    try {
      await work()
    } finally {
      const left = (deciding.get(orderId) ?? 1) - 1
      if (left === 0) deciding.delete(orderId)
      else deciding.set(orderId, left)
    }
  }
  return { has: (orderId) => deciding.has(orderId), during: whileDeciding }
}

// Where every surface's answer to "what is this order doing" comes from.
//
// Assembled once and handed to both the order list and the Floor, because
// the alternative was tried and shipped: each surface worked it out from
// whatever it happened to hold, so the same order halted at an undecided
// gate read "ready to hand off" in the list and drew `building` chips on
// the Floor, and neither of them named the gate.
export function createStandingSources(
  dataRoot: () => string,
  deciding: Deciding
): LiveStandingSources {
  return {
    graphFor: (orderId) => readGraph(dataRoot(), orderId),
    shapingFor: async (orderId) => {
      if (deciding.has(orderId)) return true
      const last = lastIntake(await orderStoreAt(dataRoot()).entries(orderId))
      return last.kind === 'running' && isLiveSession(last.sessionId)
    },
    gatesFor: (orderId) => indexFor(dataRoot()).gatesOf(orderId),
    // A run belongs to a card whose directory is named for the order, which is
    // the join between the runtime's bookkeeping and the records'.
    asksFor: (orderId) =>
      pendingPermissions.list().filter((ask) => path.basename(ask.featureDir) === orderId).length,
    // Shadow firings are recorded and deliberately never notified. A standing
    // is a notification, so a shadow firing is not one.
    stallsFor: (orderId) =>
      stallFirings.filter((s) => !s.shadow && path.basename(s.featureDir) === orderId).length,
    // Only counted while the process is still there: an agent that was
    // stranded and has since died is orphaned, which is a different sentence
    // with a different move.
    strandedFor: (orderId) =>
      [...strandedAgents.values()].filter(
        (a) => a.orderId === orderId && isLiveSession(a.sessionId)
      ).length,
    // Not a record on disk: an agent's terminal is a child of this process, so
    // only this process can say whether one is still there.
    orphansFor: (orderId, graph) =>
      executingOrders.has(orderId) ? [] : orphanedNodes(graph, isLiveSession).map((n) => n.id),
  } satisfies StandingSources
}

export interface LiveStandings {
  readonly orders: WorkOrder[]
  readonly waiting: WaitingOrder[]
}

// Every live order's standing, read the way every surface reads it.
export async function readLiveStandings(
  dataRoot: () => string,
  standingSources: LiveStandingSources
): Promise<LiveStandings> {
  const orders = (await createLiveOrderStore(dataRoot, indexFor).list()).filter(
    (order) => order.status !== 'cancelled'
  )
  const sources = { ...standingSources, ...orderStandingSources(orderStoreAt(dataRoot())) }
  const waiting = await Promise.all(
    orders.map(async (order) => ({
      orderId: order.id,
      standing: await readStanding(order, sources),
    }))
  )
  return { orders, waiting }
}
