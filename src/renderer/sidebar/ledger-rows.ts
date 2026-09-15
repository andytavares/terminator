import { matchesFilter, type IssueTitles } from './session-filter'
import type { HomePrefs } from './home-prefs'
import type { SessionFacts } from './session-facts'
import type { AgentState } from '../../shared/types/index'

export interface LedgerGroup {
  key: string
  label: string
  facts: SessionFacts[]
}

export interface LedgerFilters {
  needsYou: boolean
  text: string
}

export const NO_FILTERS: LedgerFilters = { needsYou: false, text: '' }

const NO_PROJECT = 'No project'
const ALL_SESSIONS = 'All sessions'
const CLOSED = 'Closed'

/** Blocked on the operator first: it is the only state that waits for them. */
const STATE_RANK: Record<AgentState, number> = {
  'awaiting-input': 0,
  working: 1,
  idle: 2,
  exited: 3,
}

function groupLabel(facts: SessionFacts, groupBy: HomePrefs['groupBy']): string {
  if (groupBy === 'none') return ALL_SESSIONS
  if (facts.projectName === null) return NO_PROJECT
  if (groupBy === 'project') return facts.projectName
  return `${facts.workspaceName ?? NO_PROJECT} / ${facts.projectName}`
}

function compare(sort: HomePrefs['sort']) {
  return (a: SessionFacts, b: SessionFacts): number => {
    if (sort === 'needs-you') {
      const byState = STATE_RANK[a.state] - STATE_RANK[b.state]
      if (byState !== 0) return byState
    }
    return b.lastActivityAt - a.lastActivityAt
  }
}

/**
 * The Ledger's rows, grouped and ordered.
 *
 * Filters apply first, so a group that loses every row to them is not drawn.
 * Closed sessions are always their own last group, newest first: they are
 * history, and ordering them by state would put every one of them last anyway.
 */
export function buildLedger(
  facts: readonly SessionFacts[],
  prefs: HomePrefs,
  filters: LedgerFilters,
  titles: IssueTitles
): LedgerGroup[] {
  const visible = facts.filter(
    (f) =>
      !(prefs.hideExited && !f.isClosed && f.state === 'exited') &&
      !(filters.needsYou && f.state !== 'awaiting-input') &&
      matchesFilter(f, filters.text, titles)
  )

  const byLabel = new Map<string, SessionFacts[]>()
  for (const f of visible.filter((f) => !f.isClosed)) {
    const label = groupLabel(f, prefs.groupBy)
    byLabel.set(label, [...(byLabel.get(label) ?? []), f])
  }

  const open = [...byLabel.entries()]
    .sort(([a], [b]) => {
      if (a === NO_PROJECT) return 1
      if (b === NO_PROJECT) return -1
      return a.localeCompare(b)
    })
    .map(([label, rows]) => ({ key: label, label, facts: rows.sort(compare(prefs.sort)) }))

  const closed = visible
    .filter((f) => f.isClosed)
    .sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? ''))

  return closed.length === 0 ? open : [...open, { key: CLOSED, label: CLOSED, facts: closed }]
}
