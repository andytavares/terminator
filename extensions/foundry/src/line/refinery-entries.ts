import type { WorkOrder } from '../order/schema.js'
import type { OrderStore } from '../order/store.js'
import type { QueueEntry } from './refinery.js'
import { readObservedFiles } from './observed-files.js'
import { readPulls } from './integrate.js'
import { readRefineryState } from './refinery-state.js'

// The queue's own data, assembled from live orders.
//
// `queue`, `laterOverlapping` and `advisory` all take `QueueEntry[]` and know
// nothing about where one comes from. This is where one comes from: every
// order actually in flight (`running` or `shipped` — a draft or a cancelled
// order has nothing on disk to collide with), one entry per repository it
// spans, carrying the files that repository's checkout has actually touched.
//
// I/O stays behind `deps` so this is exercisable with fakes rather than a real
// checkout and a real `gh`.

export interface QueueEntriesDeps {
  /** The pulls this order has opened so far, if any. */
  readonly readPulls: (orderId: string) => Promise<readonly { readonly repo: string }[]>
  /** What the order's checkout has actually changed, against its base. */
  readonly changedFiles: (order: WorkOrder) => Promise<readonly string[]>
  readonly merged: (orderId: string) => boolean
  readonly agreedAt: (order: WorkOrder) => string
}

/**
 * The queue entries every in-flight order contributes.
 *
 * A lane with no draft open yet and nothing a checkout has changed falls back
 * to the plan's own declared `touches` for that lane — an order that queued
 * behind another before its worktree existed still has something for
 * `advisory` and `laterOverlapping` to compare against.
 */
export async function queueEntries(
  orders: readonly WorkOrder[],
  deps: QueueEntriesDeps
): Promise<QueueEntry[]> {
  const entries: QueueEntry[] = []

  for (const order of orders) {
    if (order.status !== 'running' && order.status !== 'shipped') continue

    const pulls = await deps.readPulls(order.id)
    const observed = await deps.changedFiles(order)
    const hasCheckout = pulls.length > 0 || observed.length > 0
    const merged = deps.merged(order.id)
    const agreedAt = deps.agreedAt(order)

    for (const repo of order.context.repos) {
      const files = hasCheckout
        ? [...observed]
        : order.plan.units.filter((unit) => unit.lane === repo.lane).flatMap((unit) => unit.touches)

      entries.push({
        orderId: order.id,
        title: order.title,
        repo: repo.name,
        base: repo.baseBranch,
        agreedAt,
        files,
        merged,
      })
    }
  }

  return entries
}

/**
 * Every in-flight order's queue entries, for the refinery's file-overlap
 * queue: the observe/list channels' `queue` field, and the advisory shown on
 * agreement.
 *
 * Reads records only. The files a checkout changed are the ones recorded when
 * its last step settled (`observed-files.ts`), so asking for the queue never
 * starts a process.
 */
export async function computeQueueEntries(
  root: string,
  store: Pick<OrderStore, 'list'>
): Promise<QueueEntry[]> {
  const orders = await store.list()
  const merged = new Set<string>()
  for (const order of orders.filter((o) => o.status === 'running' || o.status === 'shipped')) {
    if ((await readRefineryState(root, order.id)).mergedAt !== null) merged.add(order.id)
  }
  return queueEntries(orders, {
    readPulls: (orderId) => readPulls(root, orderId),
    changedFiles: (order) => readObservedFiles(root, order.id),
    merged: (orderId) => merged.has(orderId),
    agreedAt: (order) => order.agreedAt ?? '',
  })
}
