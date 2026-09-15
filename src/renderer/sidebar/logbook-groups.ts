import { matchesFilter, type IssueTitles } from './session-filter'
import { STATUS_ORDER } from './view-model'
import type { SessionFacts } from './session-facts'
import type { AgentState, IssueSummary } from '../../shared/types/index'

export interface LogbookGroup {
  key: string
  label: string
  facts: SessionFacts[]
}

const LABEL: Record<AgentState, string> = {
  'awaiting-input': 'Needs you',
  working: 'Working',
  idle: 'Idle',
  exited: 'Exited',
}

const CLOSED = 'Closed'
const SUGGESTIONS = 3

/** The Logbook's list: by what each session is doing, then closed history, newest first. */
export function buildLogbook(
  facts: readonly SessionFacts[],
  text: string,
  titles: IssueTitles
): LogbookGroup[] {
  const shown = facts.filter((f) => matchesFilter(f, text, titles))
  const open = STATUS_ORDER.map((state) => ({
    key: state,
    label: LABEL[state],
    facts: shown
      .filter((f) => !f.isClosed && f.state === state)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt),
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
