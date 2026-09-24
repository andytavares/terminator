import { matchesFilter, type IssueTitles } from './session-filter'
import type { HomePrefs } from './home-prefs'
import type { SessionFacts } from './session-facts'
import { standingRank } from './view-model'

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

const NO_BRANCH = 'No branch'
const ALL_SESSIONS = 'All sessions'
const CLOSED = 'Closed'
const NEEDS_YOU = 'needs-you'

function groupLabel(facts: SessionFacts, groupBy: HomePrefs['groupBy']): string {
  if (groupBy === 'none') return ALL_SESSIONS
  if (facts.projectName === null) return NO_BRANCH
  if (groupBy === 'project') return facts.projectName
  return `${facts.workspaceName ?? NO_BRANCH} / ${facts.projectName}`
}

const byStarted = (a: SessionFacts, b: SessionFacts): number =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt)

/** Most recently opened first, a session that has never been attended sorting last. */
const byRecentlyOpened = (a: SessionFacts, b: SessionFacts): number => {
  if (a.lastAttendedAt === null && b.lastAttendedAt === null) return byStarted(a, b)
  if (a.lastAttendedAt === null) return 1
  if (b.lastAttendedAt === null) return -1
  return b.lastAttendedAt - a.lastAttendedAt || byStarted(a, b)
}

function compare(sort: HomePrefs['sort']) {
  return (a: SessionFacts, b: SessionFacts): number => {
    if (sort === 'recent') return byRecentlyOpened(a, b)
    return standingRank(a.state) - standingRank(b.state) || byStarted(a, b)
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

  const openVisible = visible.filter((f) => !f.isClosed)
  const liftNeedsYou = prefs.sort === 'needs-you'
  const needsYou = liftNeedsYou ? openVisible.filter((f) => f.state === 'awaiting-input') : []
  const rest = liftNeedsYou ? openVisible.filter((f) => f.state !== 'awaiting-input') : openVisible

  const byLabel = new Map<string, SessionFacts[]>()
  for (const f of rest) {
    const label = groupLabel(f, prefs.groupBy)
    byLabel.set(label, [...(byLabel.get(label) ?? []), f])
  }

  const open = [...byLabel.entries()]
    .sort(([a], [b]) => {
      if (a === NO_BRANCH) return 1
      if (b === NO_BRANCH) return -1
      return a.localeCompare(b)
    })
    .map(([label, rows]) => ({ key: label, label, facts: rows.sort(compare(prefs.sort)) }))

  const needsYouGroup: LedgerGroup[] =
    needsYou.length === 0
      ? []
      : [{ key: NEEDS_YOU, label: 'Needs you', facts: needsYou.sort(compare(prefs.sort)) }]

  const closed = visible
    .filter((f) => f.isClosed)
    .sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? ''))

  const closedGroup: LedgerGroup[] =
    closed.length === 0 ? [] : [{ key: CLOSED, label: CLOSED, facts: closed }]

  return [...needsYouGroup, ...open, ...closedGroup]
}
