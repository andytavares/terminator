import { STATUS_ORDER, isStale, type SessionView, type SortKey } from './view-model'
import { aggregateBranchState, countInState } from './branch-state'
import { branchLabel } from './branch-display'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import type { AgentState, Project, TerminalSession, Workspace } from '../../shared/types/index'

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

/** Grouping everything under one heading needs a stable identity for it. */
const ALL_KEY = '__all__'

function matchesQuery(
  row: { label: string },
  repoName: string,
  sessions: TerminalSession[],
  query: string
): boolean {
  if (row.label.toLowerCase().includes(query)) return true
  if (repoName.toLowerCase().includes(query)) return true
  return sessions.some((s) => s.tabTitle.toLowerCase().includes(query))
}

function compareBranches(a: BranchRow, b: BranchRow, sortBy: SortKey): number {
  switch (sortBy) {
    case 'name':
      return a.label.localeCompare(b.label)
    case 'status':
      return STATUS_ORDER.indexOf(a.state) - STATUS_ORDER.indexOf(b.state)
    case 'oldest':
      return (a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0)
    case 'recent':
    default:
      return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
  }
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
  sessions: TerminalSession[],
  projects: Project[],
  workspaces: Workspace[],
  view: SessionView,
  now: number,
  staleAfterMs: number
): BranchRowsResult {
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]))
  const { query, states, projectIds, hideStale, staleOnly } = view.filters
  const normalisedQuery = query?.trim().toLowerCase()

  const sessionsByProject = new Map<string, TerminalSession[]>()
  const scratch: TerminalSession[] = []
  for (const session of sessions) {
    if (session.projectId === SCRATCH_PROJECT_ID) {
      scratch.push(session)
      continue
    }
    const bucket = sessionsByProject.get(session.projectId)
    if (bucket === undefined) sessionsByProject.set(session.projectId, [session])
    else bucket.push(session)
  }

  const candidates = projects.filter((p) => workspaceById.has(p.workspaceId))
  const total = candidates.length

  const kept: Array<{ project: Project; row: BranchRow; repo: Workspace }> = []

  for (const project of candidates) {
    const repo = workspaceById.get(project.workspaceId)!
    const own = sessionsByProject.get(project.id) ?? []
    const state = aggregateBranchState(own)
    const row: BranchRow = {
      projectId: project.id,
      label: branchLabel(project),
      isWorktree: project.isWorktree,
      state,
      stateCount: countInState(own, state),
      sessionCount: own.length,
      lastActivityAt: own.length === 0 ? null : Math.max(...own.map((s) => s.lastActivityAt)),
      workspaceId: project.workspaceId,
    }

    if (normalisedQuery !== undefined && !matchesQuery(row, repo.name, own, normalisedQuery)) {
      continue
    }
    if (projectIds !== undefined && !projectIds.includes(project.id)) continue
    if (states !== undefined && !own.some((s) => states.includes(s.agentState))) continue
    if (staleOnly === true && !own.some((s) => isStale(s, now, staleAfterMs))) continue
    // A branch nobody has opened is not abandoned work, so hideStale passes it by.
    if (hideStale === true && own.length > 0 && own.every((s) => isStale(s, now, staleAfterMs))) {
      continue
    }

    kept.push({ project, row, repo })
  }

  const grouped = new Map<string, RepoGroup>()
  for (const { row, repo } of kept) {
    const key = view.groupBy === 'none' ? ALL_KEY : repo.id
    let group = grouped.get(key)
    if (group === undefined) {
      group = {
        workspaceId: view.groupBy === 'none' ? ALL_KEY : repo.id,
        label: view.groupBy === 'none' ? 'All branches' : repo.name,
        color: view.groupBy === 'none' ? '' : repo.color,
        folderPath: view.groupBy === 'none' ? '' : repo.folderPath,
        branches: [],
        branchCount: 0,
        needsYou: false,
      }
      grouped.set(key, group)
    }
    group.branches.push(row)
    if (row.state === 'awaiting-input') group.needsYou = true
  }

  const groups = [...grouped.values()]
    .map((group) => ({
      ...group,
      branches: [...group.branches].sort((a, b) => compareBranches(a, b, view.sortBy)),
      branchCount: group.branches.length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return { groups, scratch, shown: kept.length, total }
}
