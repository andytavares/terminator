import { agreedFacts } from './intake-outcome.js'
import type { LedgerEntry } from '../ledger/append.js'
import type { WorkOrder } from '../order/schema.js'

// What happens when a draft finishes shaping and passes every check.
//
// A draft the operator never released waits for the Forge's Hand off button —
// a run that starts by itself is work the operator did not release
// (tests/hand-off.spec.ts). A draft they did release, that a defect sent back
// mid-run, is different: answering the defect was the decision to carry on,
// so the amended order is agreed again and the run restarts. WO-1008-287 sat
// amended and ready for good, with a toast as its only notice.

export type Step = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export interface ReleaseDeps {
  entries(orderId: string): Promise<readonly LedgerEntry[]>
  agree(order: WorkOrder): Promise<Step>
  start(order: WorkOrder): Promise<Step>
  /** Records why the run did not restart, where the standing reads it. */
  refuse(order: WorkOrder, reason: string): Promise<void>
  sayReady(order: WorkOrder): void
  sayRestarted(order: WorkOrder): void
}

export async function readyToHandOff(
  order: WorkOrder,
  deps: ReleaseDeps
): Promise<'waiting' | 'restarted' | 'refused'> {
  if (agreedFacts(await deps.entries(order.id)) === null) {
    deps.sayReady(order)
    return 'waiting'
  }
  for (const step of [deps.agree, deps.start]) {
    const done = await step(order)
    if (!done.ok) {
      await deps.refuse(order, done.reason)
      return 'refused'
    }
  }
  deps.sayRestarted(order)
  return 'restarted'
}
