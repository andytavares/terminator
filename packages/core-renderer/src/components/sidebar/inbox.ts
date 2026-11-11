import { create } from 'zustand'
import { focusFirst, type WorkThread } from '../../home/work-threads'
import { isSettled, type WorkMarks } from '../../home/settle'
import { threadMatches } from '../home/desk-search'

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

function rankOf(thread: WorkThread, marks: WorkMarks): number {
  if (thread.state === 'needs-you') return 0
  return marks.pinned[thread.key] !== undefined ? 1 : 2
}

/** Splits the threads into the cards on top and the settled ones below. */
export function inboxSections(
  threads: readonly WorkThread[],
  marks: WorkMarks,
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

/** The threads that match the search text and sit in the chosen repo. */
export function filterInbox(threads: readonly WorkThread[], filter: InboxFilter): WorkThread[] {
  return threads.filter(
    (t) =>
      threadMatches(t, filter.text) &&
      (filter.repoRoot === null || t.lanes.some((lane) => lane.repoRoot === filter.repoRoot))
  )
}

export interface HiddenAsks {
  count: number
  /** Each repo the hidden asks sit in, once. */
  repoNames: string[]
}

/** The asks that match the search text but sit outside the chosen repo. */
export function asksHiddenByRepo(threads: readonly WorkThread[], filter: InboxFilter): HiddenAsks {
  const shown = new Set(filterInbox(threads, filter))
  const hidden = threads.filter(
    (t) => t.state === 'needs-you' && !shown.has(t) && threadMatches(t, filter.text)
  )
  const repoNames = new Set(hidden.flatMap((t) => t.lanes.map((lane) => lane.repoName)))
  return { count: hidden.length, repoNames: [...repoNames] }
}

/** The Inbox's search and repo filter, kept while the sidebar shows another mode. */
export const useInboxFilter = create<{
  filter: InboxFilter
  setFilter: (filter: InboxFilter) => void
}>((set) => ({
  filter: { text: '', repoRoot: null },
  setFilter: (filter) => set({ filter }),
}))
