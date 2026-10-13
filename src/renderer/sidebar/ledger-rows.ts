import { matchesFilter, type IssueTitles } from './session-filter'
import type { HomePrefs } from './home-prefs'
import { byRecentlyOpened, byStarted, type SessionFacts } from './session-facts'
import { standingRank } from './view-model'

export interface LedgerGroup {
  key: string
  label: string
  facts: SessionFacts[]
}

/** @internal */
export interface LedgerFilters {
  needsYou: boolean
  text: string
}

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

function compare(sort: HomePrefs['sort']) {
  return (a: SessionFacts, b: SessionFacts): number => {
    if (sort === 'recent') return byRecentlyOpened(a, b)
    return standingRank(a.state) - standingRank(b.state) || byStarted(a, b)
  }
}

/** The filters, and the issue titles the text filter also searches. */
export interface LedgerQuery extends LedgerFilters {
  titles: IssueTitles
}

function isVisible(f: SessionFacts, prefs: HomePrefs, query: LedgerQuery): boolean {
  if (prefs.hideExited && !f.isClosed && f.state === 'exited') return false
  if (query.needsYou && f.state !== 'awaiting-input') return false
  return matchesFilter(f, query.text, query.titles)
}

/** Open sessions under their branch label, labels in order with "No branch" last. */
function openGroups(open: SessionFacts[], prefs: HomePrefs): LedgerGroup[] {
  const byLabel = new Map<string, SessionFacts[]>()
  for (const f of open) {
    const label = groupLabel(f, prefs.groupBy)
    byLabel.set(label, [...(byLabel.get(label) ?? []), f])
  }
  return [...byLabel.entries()]
    .sort(([a], [b]) => {
      if (a === NO_BRANCH) return 1
      if (b === NO_BRANCH) return -1
      return a.localeCompare(b)
    })
    .map(([label, rows]) => ({ key: label, label, facts: rows.sort(compare(prefs.sort)) }))
}

/** A group of its own, or none when it would be empty. */
function groupOf(key: string, label: string, facts: SessionFacts[]): LedgerGroup[] {
  return facts.length === 0 ? [] : [{ key, label, facts }]
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
  query: LedgerQuery
): LedgerGroup[] {
  const visible = facts.filter((f) => isVisible(f, prefs, query))
  const openVisible = visible.filter((f) => !f.isClosed)
  const liftNeedsYou = prefs.sort === 'needs-you'
  const needsYou = liftNeedsYou ? openVisible.filter((f) => f.state === 'awaiting-input') : []
  const rest = liftNeedsYou ? openVisible.filter((f) => f.state !== 'awaiting-input') : openVisible
  const closed = visible
    .filter((f) => f.isClosed)
    .sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? ''))

  return [
    ...groupOf(NEEDS_YOU, 'Needs you', needsYou.sort(compare(prefs.sort))),
    ...openGroups(rest, prefs),
    ...groupOf(CLOSED, CLOSED, closed),
  ]
}
