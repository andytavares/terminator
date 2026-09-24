import { matchesFilter, type IssueTitles } from './session-filter'
import type { SessionFacts } from './session-facts'
import type { IssueSummary } from '../../shared/types/index'

export interface LogbookGroup {
  key: string
  label: string
  facts: SessionFacts[]
}

const GROUPS: Array<{ key: string; label: string; match: (facts: SessionFacts) => boolean }> = [
  { key: 'needs-you', label: 'Needs you', match: (f) => f.state === 'awaiting-input' },
  { key: 'running', label: 'Running', match: (f) => f.state === 'working' || f.state === 'idle' },
  { key: 'exited', label: 'Exited', match: (f) => f.state === 'exited' },
]

const CLOSED = 'Closed'
const SUGGESTIONS = 3

const byStarted = (a: SessionFacts, b: SessionFacts): number =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt)

/** The Logbook's list: by what each session is doing, then closed history, newest first. */
export function buildLogbook(
  facts: readonly SessionFacts[],
  text: string,
  titles: IssueTitles
): LogbookGroup[] {
  const shown = facts.filter((f) => matchesFilter(f, text, titles))
  const open = GROUPS.map(({ key, label, match }) => ({
    key,
    label,
    facts: shown.filter((f) => !f.isClosed && match(f)).sort(byStarted),
  }))
  const closed = {
    key: CLOSED,
    label: CLOSED,
    facts: shown
      .filter((f) => f.isClosed)
      .sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? '')),
  }
  return [...open, closed].filter((g) => g.facts.length > 0)
}

/**
 * What a session is called in the Logbook: what it is for.
 *
 * `blank` marks a session nobody has said anything about, which the list draws
 * as a request rather than a name.
 */
export function headlineOf(
  facts: SessionFacts,
  titles: IssueTitles
): { text: string; blank: boolean } {
  const ref = facts.workItem?.ref
  if (ref) return { text: titles.get(`${ref.tracker}:${ref.key}`) ?? ref.key, blank: false }
  if (facts.description !== null) return { text: facts.description.split('\n')[0], blank: false }
  return { text: 'Add a description', blank: true }
}

/**
 * Tickets worth linking this session to, in one click.
 *
 * A project is linked to one ticket, not to a tracker project, so "open tickets
 * in this project" cannot be derived. What can: the project's own ticket, when
 * the session is not already on it, then the operator's own open tickets.
 */
export function suggestWorkItems(
  facts: SessionFacts,
  projectIssue: IssueSummary | null,
  mine: readonly IssueSummary[],
  limit = SUGGESTIONS
): IssueSummary[] {
  const current = facts.workItem?.ref
  const id = (i: { tracker: string; key: string }) => `${i.tracker}:${i.key}`
  const seen = new Set(current ? [id(current)] : [])
  const out: IssueSummary[] = []
  for (const candidate of [...(projectIssue ? [projectIssue] : []), ...mine]) {
    if (out.length === limit) break
    if (seen.has(id(candidate))) continue
    seen.add(id(candidate))
    out.push(candidate)
  }
  return out
}
