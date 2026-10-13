import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { TerminalSession } from '../../../shared/types/index'
import { busyBranchIds, type SessionView } from '../../sidebar/view-model'
import { buildBranchRows, type BranchRowsSource, type StaleClock } from '../../sidebar/branch-rows'
import { BellAndBusySource } from '../../sidebar/agent-state'
import type { WorkItem } from '../../sidebar/work-item'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { useNow } from '../session/useNow'
import { useStalenessClock } from './useStalenessClock'

/** Every repo and branch the sidebar lists, with lookups by id. */
export function useSidebarData() {
  const { workspaces, projectsByWorkspaceId } = useWorkspaceStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      projectsByWorkspaceId: s.projectsByWorkspaceId,
    }))
  )
  const allProjects = useMemo(
    () => workspaces.flatMap((ws) => projectsByWorkspaceId.get(ws.id) ?? []),
    [workspaces, projectsByWorkspaceId]
  )
  const projectById = useMemo(() => new Map(allProjects.map((p) => [p.id, p])), [allProjects])
  const workspaceById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces])
  return { workspaces, projectsByWorkspaceId, allProjects, projectById, workspaceById }
}

export type SidebarData = ReturnType<typeof useSidebarData>

/**
 * The sessions the list is built from, with their agent state derived.
 *
 * agentState is view state derived from bell, byte flow and exit — the type
 * says so, but nothing was deriving it, so every session read as 'idle'
 * forever and the Needs me / Active / Stale views filtered on a constant.
 * Deriving here keeps it a pure function of the store rather than a fourth
 * thing to hold in sync, and keeps buildGroups pure.
 */
function liveSessions(sessions: Map<string, TerminalSession>): TerminalSession[] {
  const source = new BellAndBusySource()
  // Derive before filtering: the keep-if-exited rule reads agentState, and
  // reading it before deriving would drop every closed session.
  return [...sessions.values()]
    .map((s) => {
      const agentState = source.derive(s)
      return agentState === s.agentState ? s : { ...s, agentState }
    })
    .filter((s) => s.status !== 'closed' || s.agentState === 'exited')
}

/**
 * Work in a terminal changes the tree under it, so a branch whose terminals
 * just stopped printing gets its statistics dropped rather than waiting out
 * the TTL: once per burst, not once per activity stamp. Tracked here rather
 * than in the session store: making the session store import the stats store
 * would couple two things that have no other reason to know about each other.
 */
function useRefreshStatsWhenSettled(sessionList: TerminalSession[]): void {
  const invalidateStats = useChangeStatsStore((s) => s.invalidate)
  /** Branches that were printing at the last render, so one settling refreshes its statistics. */
  const busyBranches = useRef(new Set<string>())
  useEffect(() => {
    const busyNow = busyBranchIds(sessionList)
    for (const projectId of busyBranches.current) {
      if (!busyNow.has(projectId)) invalidateStats(projectId)
    }
    busyBranches.current = busyNow
  }, [sessionList, invalidateStats])
}

interface RowsInput {
  data: SidebarData
  view: SessionView
  views: SessionView[]
  /** Injected by tests so relative times and staleness are deterministic. */
  now: number | undefined
  workItems: Map<string, WorkItem | null>
}

/** The branch rows the active view shows, and what each saved view would show. */
export function useSidebarRows({ data, view, views, now, workItems }: RowsInput) {
  const sessions = useSessionStore((s) => s.sessions)
  const staleAfterMs = useSettingsStore((s) => s.resolveSettings().sidebar.staleAfterMs)
  const sessionList = useMemo(() => liveSessions(sessions), [sessions])
  useRefreshStatsWhenSettled(sessionList)
  const currentTime = useNow()
  const clock = now ?? currentTime
  const rowsNow = useStalenessClock(sessionList, clock, staleAfterMs)
  const staleClock = useMemo(() => ({ now: rowsNow, staleAfterMs }), [rowsNow, staleAfterMs])
  const { allProjects: projects, workspaces } = data
  const rows = useMemo(
    () =>
      buildBranchRows({ sessions: sessionList, projects, workspaces, workItems }, view, staleClock),
    [sessionList, projects, workspaces, workItems, view, staleClock]
  )
  const viewCounts = useMemo(
    () => countViews(views, { sessions: sessionList, projects, workspaces }, staleClock),
    [views, sessionList, projects, workspaces, staleClock]
  )
  return { ...rows, viewCounts, clock, sessions, sessionList }
}

/**
 * What each view would show, so a chip can say "Needs me · 6" without the
 * user having to switch to it and look.
 */
function countViews(
  views: SessionView[],
  source: BranchRowsSource,
  clock: StaleClock
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of views) out[v.id] = buildBranchRows(source, v, clock).shown
  return out
}
