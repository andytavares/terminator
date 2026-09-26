import type { WorkOrder } from '../order/schema.js'
import type { QueueEntry } from './refinery.js'

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
