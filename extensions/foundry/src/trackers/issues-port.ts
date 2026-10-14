import type { ExtensionAPI } from '@terminator/extension-sdk'

import type { IssuesPort, WriteBackDeps } from './write-back.js'
import type { WorkOrder } from '../order/schema.js'

import { orderStoreAt } from '../state/live-index.js'
import { isoNow } from '../host-calls.js'

/** The application's tracker connection, narrowed to what write-back needs. */
export function issuesPortFor(api: ExtensionAPI): IssuesPort {
  const issues = api.issues
  return {
    comment: ({ tracker, key }, body) => issues.comment(tracker as never, key, body),
    transition: ({ tracker, key }, intent, optionId) =>
      issues.transition(tracker as never, key, intent, optionId),
    states: async ({ tracker, key }) => issues.states(tracker as never, key),
    supportsTransitions: (tracker) => issues.supportsTransitions(tracker as never),
  }
}

export function writeBackDepsFor(
  root: string,
  order: WorkOrder,
  issues: IssuesPort
): WriteBackDeps {
  return {
    issues,
    now: isoNow,
    // Null means "let the tracker resolve it", which is not the same as an
    // empty override, so the nulls are stripped rather than passed through.
    mapping: Object.fromEntries(
      Object.entries(order.stateMapping).filter(([, value]) => value !== null)
    ) as WriteBackDeps['mapping'],
    record: async (action, subject, reason) => {
      await orderStoreAt(root).record({
        at: new Date().toISOString(),
        orderId: order.id,
        actor: 'rule:writeback',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
  }
}
