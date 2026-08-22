import type { AgentState, Project, TerminalSession, Workspace } from '../../shared/types/index'

// This module is the pure core of the sidebar: it decides *what* is shown from
// (data, view, now) and knows nothing about React, the stores, or the clock.
// Keeping it free of those imports is what makes the layout reversible and the
// behaviour exhaustively testable — do not import anything but types here.

export type GroupKey = 'project' | 'workspace' | 'status' | 'branch' | 'none'
export type SortKey = 'recent' | 'oldest' | 'name' | 'status' | 'manual'

export interface SessionFilters {
  query?: string
  states?: AgentState[]
  projectIds?: string[]
  hideStale?: boolean
  staleOnly?: boolean
}

export interface SessionView {
  id: string
  name: string
  groupBy: GroupKey
  sortBy: SortKey
  filters: SessionFilters
  builtIn?: boolean
}

export type GroupScope =
  | { kind: 'project'; projectId: string; workspaceId: string }
  | { kind: 'workspace'; workspaceId: string }

export interface Group {
  /** Stable within a grouping mode for the lifetime of the underlying entity. */
  key: string
  label: string
  /** Present only when the grouping key is a scope; that is what lets the header host scope actions. */
  scope?: GroupScope
  sessions: TerminalSession[]
  count: number
}

export interface BuildResult {
  groups: Group[]
  /** Sessions after filtering. */
  shown: number
  /** Sessions before filtering — with `shown`, this is what the filter notice reads. */
  total: number
}

/** Severity order, shared by status grouping and status sorting so they never disagree. */
const STATUS_ORDER: AgentState[] = ['awaiting-input', 'working', 'idle', 'exited']

const STATUS_LABEL: Record<AgentState, string> = {
  'awaiting-input': 'Needs you',
  working: 'Working',
  idle: 'Idle',
  exited: 'Exited',
}

/**
 * A session is stale when it has exited, or when it has been quiet for longer
 * than the threshold. A session waiting on you is never stale however long it
 * waits — it is blocked on you, which is the opposite of abandoned.
 *
 * `now` is a parameter, never read from the clock, so staleness recomputes as
 * time passes and stays testable at its boundaries.
 */
export function isStale(session: TerminalSession, now: number, staleAfterMs: number): boolean {
  if (session.agentState === 'exited') return true
  if (session.agentState === 'awaiting-input') return false
  return now - session.lastActivityAt > staleAfterMs
}

function matchesQuery(
  session: TerminalSession,
  project: Project | undefined,
  query: string
): boolean {
  const haystack = [session.tabTitle, session.note, project?.name, project?.gitBranch]
  return haystack.some((field) => field?.toLowerCase().includes(query))
}

interface Bucket {
  key: string
  label: string
  scope?: GroupScope
  sessions: TerminalSession[]
  /** Sorts the groups themselves; lower comes first. */
  order: number
}

function bucketFor(
  groupBy: GroupKey,
  session: TerminalSession,
  project: Project,
  workspace: Workspace | undefined,
  projects: Project[],
  workspaces: Workspace[]
): Bucket {
  switch (groupBy) {
    case 'project':
      return {
        key: project.id,
        label: project.name,
        scope: { kind: 'project', projectId: project.id, workspaceId: project.workspaceId },
        sessions: [],
        order: projects.indexOf(project),
      }
    case 'workspace':
      return {
        key: project.workspaceId,
        label: workspace?.name ?? project.workspaceId,
        scope: { kind: 'workspace', workspaceId: project.workspaceId },
        sessions: [],
        order: workspace ? workspaces.indexOf(workspace) : Number.MAX_SAFE_INTEGER,
      }
    case 'status':
      return {
        key: session.agentState,
        label: STATUS_LABEL[session.agentState],
        sessions: [],
        order: STATUS_ORDER.indexOf(session.agentState),
      }
    case 'branch': {
      const branch = project.gitBranch ?? ''
      return {
        key: `branch:${branch}`,
        label: branch || 'No branch',
        sessions: [],
        order: 0,
      }
    }
    case 'none':
      return { key: 'all', label: 'All sessions', sessions: [], order: 0 }
  }
}

function compareSessions(a: TerminalSession, b: TerminalSession, sortBy: SortKey): number {
  switch (sortBy) {
    case 'recent':
      return b.lastActivityAt - a.lastActivityAt
    case 'oldest':
      return a.lastActivityAt - b.lastActivityAt
    case 'name':
      return a.tabTitle.localeCompare(b.tabTitle, undefined, { sensitivity: 'base' })
    case 'status':
      return STATUS_ORDER.indexOf(a.agentState) - STATUS_ORDER.indexOf(b.agentState)
    case 'manual':
      return 0
  }
}

/**
 * Applies a view to the current data: filter, then group, then sort within each
 * group, then sort the groups. Pure — the same arguments always produce a
 * deeply equal result and no input is mutated.
 */
export function buildGroups(
  sessions: TerminalSession[],
  projects: Project[],
  workspaces: Workspace[],
  view: SessionView,
  now: number,
  staleAfterMs: number
): BuildResult {
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]))
  const { query, states, projectIds, hideStale, staleOnly } = view.filters
  const normalisedQuery = query?.trim().toLowerCase()

  const kept = sessions.filter((session) => {
    const project = projectById.get(session.projectId)
    if (normalisedQuery && !matchesQuery(session, project, normalisedQuery)) return false
    if (states && !states.includes(session.agentState)) return false
    if (projectIds && !projectIds.includes(session.projectId)) return false
    if (staleOnly && !isStale(session, now, staleAfterMs)) return false
    if (hideStale && isStale(session, now, staleAfterMs)) return false
    return true
  })

  const buckets = new Map<string, Bucket>()
  for (const session of kept) {
    const project = projectById.get(session.projectId)
    // A session whose project has gone is dropped rather than crashing the
    // sidebar; it still counts towards `total`, which is measured before this.
    if (!project) continue
    const workspace = workspaceById.get(project.workspaceId)
    const bucket = bucketFor(view.groupBy, session, project, workspace, projects, workspaces)
    const existing = buckets.get(bucket.key)
    if (existing) existing.sessions.push(session)
    else buckets.set(bucket.key, { ...bucket, sessions: [session] })
  }

  const groups = [...buckets.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(
      (bucket): Group => ({
        key: bucket.key,
        label: bucket.label,
        ...(bucket.scope ? { scope: bucket.scope } : {}),
        sessions: [...bucket.sessions].sort((a, b) => compareSessions(a, b, view.sortBy)),
        count: bucket.sessions.length,
      })
    )

  return { groups, shown: kept.length, total: sessions.length }
}
