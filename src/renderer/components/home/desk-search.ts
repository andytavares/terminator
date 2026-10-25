import { matchesText } from './desk-filter'
import type { WorkThread } from '../../home/work-threads'
import type { SessionFacts } from '../../sidebar/session-facts'
import type { IssueSummary } from '../../../shared/types/index'

export type SearchHit =
  | { kind: 'thread'; key: string; label: string; detail: string }
  | { kind: 'session'; sessionId: string; label: string; detail: string }
  | { kind: 'ticket'; issue: IssueSummary; label: string; detail: string }

export interface SearchInput {
  text: string
  threads: readonly WorkThread[]
  facts: readonly SessionFacts[]
  tickets: readonly IssueSummary[]
}

const MAX_HITS = 8

const threadHit = (t: WorkThread): SearchHit => ({
  kind: 'thread',
  key: t.key,
  label: t.title,
  detail: [t.ticketKey, t.lanes[0]?.repoName].filter(Boolean).join(' · '),
})

const sessionHit = (f: SessionFacts): SearchHit => ({
  kind: 'session',
  sessionId: f.sessionId,
  label: f.name,
  detail: f.branch ?? '',
})

/** Threads, open sessions, and your tickets that no thread has yet, that match the text. */
export function searchWork(input: SearchInput): SearchHit[] {
  const { text, threads, facts, tickets } = input
  if (text.trim() === '') return []
  const threadTickets = new Set(threads.map((t) => t.ticketKey))
  return [
    ...threads
      .filter((t) =>
        matchesText([t.title, t.ticketKey, ...t.lanes.flatMap((l) => [l.repoName, l.branch])], text)
      )
      .map(threadHit),
    ...facts
      .filter((f) => !f.isClosed && matchesText([f.name, f.branch, f.description], text))
      .map(sessionHit),
    ...tickets
      .filter((i) => !threadTickets.has(i.key) && matchesText([i.key, i.title], text))
      .map(
        (issue): SearchHit => ({ kind: 'ticket', issue, label: issue.title, detail: issue.key })
      ),
  ].slice(0, MAX_HITS)
}
