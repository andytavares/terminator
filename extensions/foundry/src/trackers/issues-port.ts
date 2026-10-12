import type { ExtensionAPI } from '@terminator/extension-sdk'

import type { IssuesPort, WriteBackDeps } from './write-back.js'
import type { WorkOrder } from '../order/schema.js'

import { orderStoreAt } from '../state/live-index.js'

/**
 * The application's tracker connection, narrowed to what write-back needs.
 *
 * Null when the host has no `issues` surface at all — an older core, or a test
 * harness with a partial API. Every caller treats that as "no write-back",
 * never as a failure.
 */
export function issuesPortFor(api: ExtensionAPI): IssuesPort | null {
  const issues = api.issues
  if (issues === undefined || typeof issues.supportsTransitions !== 'function') return null
  return {
    comment: (tracker, key, body) => issues.comment(tracker as never, key, body),
    transition: (tracker, key, intent, optionId) =>
      issues.transition(tracker as never, key, intent, optionId),
    states: async (tracker, key) => issues.states(tracker as never, key),
    supportsTransitions: (tracker) => issues.supportsTransitions(tracker as never),
  }
}

export function writeBackDepsFor(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder,
  issues: IssuesPort
): WriteBackDeps {
  return {
    issues,
    now: () => new Date().toISOString(),
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
