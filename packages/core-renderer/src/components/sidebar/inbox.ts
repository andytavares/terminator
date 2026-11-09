import { focusFirst, type WorkThread } from '../../home/work-threads'
import type { TaskState } from '../../home/task-state'
import { threadMatches } from '../home/desk-search'

/** A thread with no activity for this long settles on its own.
 * @internal */
export const AUTO_SETTLE_AFTER_MS = 24 * 60 * 60 * 1000

/** What the operator did to each thread in the Inbox sidebar, by work key. */
export interface InboxMarks {
  /** When each thread was settled by hand. */
  settled: Readonly<Record<string, number>>
  /** When each thread was pinned. */
  pinned: Readonly<Record<string, number>>
  /** Until when each thread is snoozed. */
  snoozed: Readonly<Record<string, number>>
}

export interface InboxSections {
  /** Needs you, then pinned, then the rest. */
  cards: WorkThread[]
  /** Settled by hand, snoozed, or quiet for a day; most recent activity first. */
  settled: WorkThread[]
}

export interface InboxFilter {
  text: string
  /** The repo folder to keep; null keeps every repo. */
  repoRoot: string | null
}

function isSettled(thread: WorkThread, marks: InboxMarks, now: number): boolean {
  if (marks.pinned[thread.key] !== undefined) return false
  if (marks.settled[thread.key] !== undefined) return true
  if ((marks.snoozed[thread.key] ?? 0) > now) return true
  // An unanswered ask must not leave the top by itself.
  return thread.state !== 'needs-you' && now - thread.lastActivity >= AUTO_SETTLE_AFTER_MS
}

function rankOf(thread: WorkThread, marks: InboxMarks): number {
  if (thread.state === 'needs-you') return 0
  return marks.pinned[thread.key] !== undefined ? 1 : 2
}

/** Splits the threads into the cards on top and the settled ones below. */
export function inboxSections(
  threads: readonly WorkThread[],
  marks: InboxMarks,
  now: number
): InboxSections {
  const cards = threads.filter((t) => !isSettled(t, marks, now))
  return {
    cards: cards.sort((a, b) => rankOf(a, marks) - rankOf(b, marks) || focusFirst(a, b)),
    settled: threads
      .filter((t) => isSettled(t, marks, now))
      .sort((a, b) => b.lastActivity - a.lastActivity),
  }
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

/** The threads that match the search text and sit in the chosen repo. */
export function filterInbox(threads: readonly WorkThread[], filter: InboxFilter): WorkThread[] {
  return threads.filter(
    (t) =>
      threadMatches(t, filter.text) &&
      (filter.repoRoot === null || t.lanes.some((lane) => lane.repoRoot === filter.repoRoot))
  )
}
