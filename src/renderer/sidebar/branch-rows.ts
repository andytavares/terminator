import { STATUS_ORDER, isStale, type SessionView, type SortKey } from './view-model'
import { aggregateBranchState, countInState } from './branch-state'
import { branchLabel } from './branch-display'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import type { AgentState, Project, TerminalSession, Workspace } from '../../shared/types/index'
import type { WorkItem } from './work-item'

/** A terminal's own work item, keyed by session id. Absent when nothing links it. */
type WorkItemsBySession = ReadonlyMap<string, WorkItem | null>

/**
 * One terminal under a branch, and the panes split off it.
 *
 * `splitSession` pins every split pane to its root session via
 * `parentSessionId` — one level, deliberately — so this mirrors what the data
 * already says rather than inventing a hierarchy for the sidebar.
 */
export interface BranchTerminal {
  sessionId: string
  title: string
  state: AgentState
  bellCount: number
  /** Panes split off this terminal. Empty for an unsplit one. */
  panes: BranchTerminal[]
  /** This terminal's own linked ticket, or the one it inherits from its branch. Null when neither has one. */
  workItem: WorkItem | null
}

/** One branch, as the sidebar draws it. */
export interface BranchRow {
  projectId: string
  /** The branch name, or the stored name when the folder is not a repository. */
  label: string
  isWorktree: boolean
  /** Folded from its terminals; idle when it has none. */
  state: AgentState
  /** How many terminals share `state` — the count that agrees with the glyph. */
  stateCount: number
  sessionCount: number
  /**
   * Its terminals, roots first with their panes beneath.
   *
   * The row drew a count and nothing else, so a split pane existed on screen
   * and nowhere else — no name, no state, and no way to reach or close it
   * except a shortcut.
   */
  terminals: BranchTerminal[]
  /** Newest across its terminals; null when it has none. */
  lastActivityAt: number | null
  workspaceId: string
}

/** One repo, and the branches under it. */
export interface RepoGroup {
  workspaceId: string
  label: string
  color: string
  /** Available as a tooltip; never drawn at rest. */
  folderPath: string
  branches: BranchRow[]
  branchCount: number
  /**
   * Any branch in this repo is waiting on the user. Reported rather than
   * decided: whether to draw it is the collapsed state's business, and
   * collapse lives in the component, not here.
   */
  needsYou: boolean
}

export interface BranchRowsResult {
  groups: RepoGroup[]
  /** Terminals with no branch to be represented by — the one place a terminal is still a row. */
  scratch: TerminalSession[]
  /** Branches after filtering. */
  shown: number
  /** Branches before filtering. */
  total: number
}

/** What the sidebar's rows are built from. */
export interface BranchRowsSource {
  sessions: TerminalSession[]
  projects: Project[]
  workspaces: Workspace[]
  /** A terminal's own work item, keyed by session id. */
  workItems?: WorkItemsBySession
}

/** When a terminal counts as stale: quiet for longer than `staleAfterMs` before `now`. */
export interface StaleClock {
  now: number
  staleAfterMs: number
}

/** Grouping everything under one heading needs a stable identity for it. */
const ALL_KEY = '__all__'

/** A branch on its way to the list: its row, its repo and its own terminals. */
interface Candidate {
  row: BranchRow
  repo: Workspace
  own: TerminalSession[]
}

/**
 * `manual` is the user's own order, and the only record of it is the order the
 * stores hand these lists over in — workspaces for repos, projects within a
 * repo. So the comparators read that order from an index map rather than
 * leaning on a stable sort, which would silently tie the result to the order
 * rows happen to be folded in.
 */
type OrderIndex = Map<string, number>

type Comparator<T> = (a: T, b: T) => number

const activity = (row: { lastActivityAt: number | null }): number => row.lastActivityAt ?? 0

function branchComparator(sortBy: SortKey, order: OrderIndex): Comparator<BranchRow> {
  const position = (row: BranchRow): number => order.get(row.projectId) ?? 0
  const comparators: Record<SortKey, Comparator<BranchRow>> = {
    manual: (a, b) => position(a) - position(b),
    name: (a, b) => a.label.localeCompare(b.label),
    status: (a, b) => STATUS_ORDER.indexOf(a.state) - STATUS_ORDER.indexOf(b.state),
    oldest: (a, b) => activity(a) - activity(b),
    recent: (a, b) => activity(b) - activity(a),
  }
  return comparators[sortBy] ?? comparators.recent
}

/** Newest across the repo's branches; null when nothing under it has run. */
function groupActivity(group: RepoGroup): number | null {
  const times = group.branches.flatMap((b) => (b.lastActivityAt === null ? [] : [b.lastActivityAt]))
  return times.length === 0 ? null : Math.max(...times)
}

/** The most severe state under the repo — an empty repo ranks as idle. */
function groupSeverity(group: RepoGroup): number {
  const ranks = group.branches.map((b) => STATUS_ORDER.indexOf(b.state))
  return ranks.length === 0 ? STATUS_ORDER.indexOf('idle') : Math.min(...ranks)
}

/**
 * The repo headers are half the list, so the sort key has to reach them too:
 * ordering only within a repo reads as a sort that does nothing.
 *
 * Every computed key falls back to the name, so two equally quiet repos land in
 * a fixed order rather than wherever the fold left them. `manual` takes no such
 * fallback — an alphabetical tie-break is exactly what would eat a drag.
 */
function groupComparator(sortBy: SortKey, order: OrderIndex): Comparator<RepoGroup> {
  const position = (group: RepoGroup): number => order.get(group.workspaceId) ?? 0
  const recency = (group: RepoGroup): number => groupActivity(group) ?? 0
  const byName: Comparator<RepoGroup> = (a, b) => a.label.localeCompare(b.label)
  const comparators: Record<SortKey, Comparator<RepoGroup>> = {
    manual: (a, b) => position(a) - position(b),
    name: byName,
    status: (a, b) => groupSeverity(a) - groupSeverity(b) || byName(a, b),
    oldest: (a, b) => recency(a) - recency(b) || byName(a, b),
    recent: (a, b) => recency(b) - recency(a) || byName(a, b),
  }
  return comparators[sortBy] ?? comparators.recent
}

/**
 * A filter that narrows to terminals — everything but `hideStale`, which is a
 * standing preference rather than a question about this list.
 */
function isNarrowed(view: SessionView): boolean {
  const { query, states, projectIds, staleOnly } = view.filters
  return (
    query !== undefined || states !== undefined || projectIds !== undefined || staleOnly === true
  )
}

function emptyGroup(repo: Workspace, flat: boolean): RepoGroup {
  return {
    workspaceId: flat ? ALL_KEY : repo.id,
    label: flat ? 'All branches' : repo.name,
    color: flat ? '' : repo.color,
    folderPath: flat ? '' : repo.folderPath,
    branches: [],
    branchCount: 0,
    needsYou: false,
  }
}

/** Each project's terminals, and the scratch terminals that belong to no branch. */
function sessionsByProject(sessions: TerminalSession[]) {
  const byProject = new Map<string, TerminalSession[]>()
  const scratch: TerminalSession[] = []
  for (const session of sessions) {
    if (session.projectId === SCRATCH_PROJECT_ID) {
      scratch.push(session)
      continue
    }
    const bucket = byProject.get(session.projectId)
    if (bucket === undefined) byProject.set(session.projectId, [session])
    else bucket.push(session)
  }
  return { byProject, scratch }
}

function branchRow(
  project: Project,
  own: TerminalSession[],
  workItems: WorkItemsBySession
): BranchRow {
  const state = aggregateBranchState(own)
  return {
    projectId: project.id,
    label: branchLabel(project),
    isWorktree: project.isWorktree,
    state,
    stateCount: countInState(own, state),
    sessionCount: own.length,
    terminals: buildTerminals(own, workItems),
    lastActivityAt: own.length === 0 ? null : Math.max(...own.map((s) => s.lastActivityAt)),
    workspaceId: project.workspaceId,
  }
}

/** The query, the branch list and the states: each lifts one level, from terminal to branch. */
function matchesNarrowing(filters: SessionView['filters'], { row, repo, own }: Candidate): boolean {
  const query = filters.query?.trim().toLowerCase()
  const names = [row.label, repo.name, ...own.map((s) => s.tabTitle)]
  if (query !== undefined && !names.some((name) => name.toLowerCase().includes(query))) {
    return false
  }
  if (filters.projectIds !== undefined && !filters.projectIds.includes(row.projectId)) return false
  const { states } = filters
  return states === undefined || own.some((s) => states.includes(s.agentState))
}

function matchesStaleness(
  filters: SessionView['filters'],
  own: TerminalSession[],
  clock: StaleClock
): boolean {
  const stale = (s: TerminalSession): boolean => isStale(s, clock.now, clock.staleAfterMs)
  if (filters.staleOnly === true && !own.some(stale)) return false
  // A branch nobody has opened is not abandoned work, so hideStale passes it by.
  return !(filters.hideStale === true && own.length > 0 && own.every(stale))
}

/** The kept branches under their repos, or under one heading when grouping is off. */
function groupBranches(kept: Candidate[], view: SessionView, workspaces: Workspace[]) {
  const grouped = new Map<string, RepoGroup>()
  for (const { row, repo } of kept) {
    const key = view.groupBy === 'none' ? ALL_KEY : repo.id
    let group = grouped.get(key)
    if (group === undefined) {
      group = emptyGroup(repo, view.groupBy === 'none')
      grouped.set(key, group)
    }
    group.branches.push(row)
    if (row.state === 'awaiting-input') group.needsYou = true
  }

  // A repo nobody has made a branch in still needs its header, or there is no
  // way into it. It is seeded here rather than appended by the component so it
  // sorts and reorders with the rest; drawn in a block of its own it could not
  // leave the bottom of the list whatever order it was given. A narrowed view
  // is the exception, on the same reasoning as a branch with no terminals: a
  // filter over terminals has nothing to say about a repo that has none.
  if (view.groupBy === 'workspace' && !isNarrowed(view)) {
    for (const repo of workspaces) {
      if (!grouped.has(repo.id)) grouped.set(repo.id, emptyGroup(repo, false))
    }
  }
  return [...grouped.values()]
}

function sortGroups(groups: RepoGroup[], sortBy: SortKey, source: BranchRowsSource): RepoGroup[] {
  const byBranch = branchComparator(sortBy, new Map(source.projects.map((p, i) => [p.id, i])))
  const byRepo = groupComparator(sortBy, new Map(source.workspaces.map((w, i) => [w.id, i])))
  return groups
    .map((group) => ({
      ...group,
      branches: [...group.branches].sort(byBranch),
      branchCount: group.branches.length,
    }))
    .sort(byRepo)
}

/**
 * The sidebar's list: repos, and the branches under them.
 *
 * Written beside `buildGroups` rather than replacing it, so the switch can land
 * under a passing suite. The difference that matters is BR-1: **every branch is
 * a row, whether or not a terminal is open on it**, unconditionally. `buildGroups`
 * seeded empty project buckets only while the view was un-narrowed; here a
 * branch is the unit of work and exists in its own right, so only a filter can
 * hide it.
 *
 * A filter lifts one level: a branch matches when any of its terminals matches.
 * A branch with no terminals therefore matches only an unfiltered view — except
 * `hideStale`, which is a standing preference about abandoned work and has
 * nothing to say about a branch nobody has started yet.
 *
 * Deliberately absent: change statistics and the linked issue key. Both arrive
 * from stores on their own schedule, and folding them in here would make the
 * result a function of when git or the tracker last answered, which is exactly
 * the determinism this layer exists to protect (ADR-031).
 */
export function buildBranchRows(
  source: BranchRowsSource,
  view: SessionView,
  clock: StaleClock
): BranchRowsResult {
  const workspaceById = new Map(source.workspaces.map((w) => [w.id, w]))
  const { byProject, scratch } = sessionsByProject(source.sessions)
  const candidates = source.projects.filter((p) => workspaceById.has(p.workspaceId))
  const kept = candidates
    .map((project): Candidate => {
      const own = byProject.get(project.id) ?? []
      const row = branchRow(project, own, source.workItems ?? new Map())
      return { row, repo: workspaceById.get(project.workspaceId)!, own }
    })
    .filter(
      (c) => matchesNarrowing(view.filters, c) && matchesStaleness(view.filters, c.own, clock)
    )
  const groups = sortGroups(groupBranches(kept, view, source.workspaces), view.sortBy, source)
  return { groups, scratch, shown: kept.length, total: candidates.length }
}

/** Roots first, each carrying the panes pinned to it. */
/**
 * The keys a branch's terminals are linked to in their own right, each once,
 * roots before their panes. A key a terminal only inherits from its branch is
 * left out — the branch row already says it.
 */
export function sessionIssueKeys(terminals: readonly BranchTerminal[]): string[] {
  const keys: string[] = []
  const visit = (t: BranchTerminal): void => {
    const key = t.workItem?.source === 'session' ? t.workItem.ref.key : null
    if (key !== null && !keys.includes(key)) keys.push(key)
    t.panes.forEach(visit)
  }
  terminals.forEach(visit)
  return keys
}

function buildTerminals(
  sessions: TerminalSession[],
  workItems: WorkItemsBySession
): BranchTerminal[] {
  const panesByParent = new Map<string, TerminalSession[]>()
  for (const s of sessions) {
    if (s.parentSessionId === undefined) continue
    const bucket = panesByParent.get(s.parentSessionId)
    if (bucket) bucket.push(s)
    else panesByParent.set(s.parentSessionId, [s])
  }
  const describe = (s: TerminalSession, panes: BranchTerminal[]): BranchTerminal => ({
    sessionId: s.id,
    title: s.tabTitle,
    state: s.agentState,
    bellCount: s.bellCount ?? 0,
    panes,
    workItem: workItems.get(s.id) ?? null,
  })
  return sessions
    .filter((s) => s.parentSessionId === undefined)
    .map((root) =>
      describe(
        root,
        (panesByParent.get(root.id) ?? []).map((pane) => describe(pane, []))
      )
    )
}
