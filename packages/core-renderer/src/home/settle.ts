import type { TaskState } from './task-state'
import type { WorkThread } from './work-threads'

/** A thread with no activity for this long settles on its own.
 * @internal */
export const AUTO_SETTLE_AFTER_MS = 24 * 60 * 60 * 1000

/** What the operator did to each thread, by work key. */
export interface WorkMarks {
  /** When each thread was settled by hand. */
  settled: Readonly<Record<string, number>>
  /** When each thread was pinned. */
  pinned: Readonly<Record<string, number>>
  /** Until when each thread is snoozed. */
  snoozed: Readonly<Record<string, number>>
}

/** Settled by hand, snoozed, or quiet for a day; pinned never, and an unanswered ask never on its own. */
export function isSettled(thread: WorkThread, marks: WorkMarks, now: number): boolean {
  if (marks.pinned[thread.key] !== undefined) return false
  if (marks.settled[thread.key] !== undefined) return true
  if ((marks.snoozed[thread.key] ?? 0) > now) return true
  return thread.state !== 'needs-you' && now - thread.lastActivity >= AUTO_SETTLE_AFTER_MS
}

/** The threads whose agent ended a turn or started asking since `before` was read. */
export function wokenKeys(
  before: ReadonlyMap<string, TaskState>,
  threads: readonly WorkThread[]
): string[] {
  return threads
    .filter((t) => {
      const was = before.get(t.key)
      if (was === undefined) return false
      return (
        (was === 'running' && t.state !== 'running') ||
        (was !== 'needs-you' && t.state === 'needs-you')
      )
    })
    .map((t) => t.key)
}
