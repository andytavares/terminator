import { useEffect, useMemo } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { useSessionFacts } from '../session/useSessionFacts'
import { useNow } from '../session/useNow'
import { useParkedThreads } from './parked-threads'
import { isDismissed, useDismissedThreads } from './dismissed-threads'
import {
  allWorkThreads,
  buildWorkThreads,
  groupThreads,
  type ThreadGroup,
  type WorkThread,
  type WorkThreadInput,
} from '../../home/work-threads'
import type { ChangeStats } from '../../../shared/schemas/git.schema'
import type { Issue } from '../../../shared/types/index'

const MINUTE_MS = 60_000

export interface WorkThreads {
  /** The work worth showing, including what the operator parked by hand. */
  threads: WorkThread[]
  groups: ThreadGroup[]
  /** Every thread, finished ones too; a Focus item reads a shipped thread from here. */
  allThreads: WorkThread[]
}

/** Each project's repo root: its workspace's folder, which is what an extension names a branch by. */
function useRepoRoots(): Map<string, string> {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWorkspaceId = useWorkspaceStore((s) => s.projectsByWorkspaceId)
  return useMemo(() => {
    const roots = new Map<string, string>()
    for (const workspace of workspaces) {
      for (const project of projectsByWorkspaceId.get(workspace.id) ?? []) {
        roots.set(project.id, workspace.folderPath)
      }
    }
    return roots
  }, [workspaces, projectsByWorkspaceId])
}

function useIssues(): Issue[] {
  const issuesByKey = useIntegrationsStore((s) => s.issuesByKey)
  const linked = useIntegrationsStore((s) => s.issues)
  return useMemo(
    () => [...issuesByKey.values(), ...linked.values()].filter((i): i is Issue => i !== null),
    [issuesByKey, linked]
  )
}

/** Uncommitted change stats by project id, asked for the projects that have a session open. */
function useChangeStats(projectIds: readonly string[]): Map<string, ChangeStats> {
  const entries = useChangeStatsStore((s) => s.entries)
  const projectsByWorkspaceId = useWorkspaceStore((s) => s.projectsByWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  useEffect(() => {
    const projects = [...projectsByWorkspaceId.values()].flat()
    for (const id of projectIds) {
      const project = projects.find((p) => p.id === id)
      const folder = workspaces.find((w) => w.id === project?.workspaceId)?.folderPath
      const cwd = project?.worktreePath ?? folder
      if (cwd) useChangeStatsStore.getState().ensure(id, cwd, Date.now())
    }
  }, [projectIds, projectsByWorkspaceId, workspaces])
  return useMemo(() => {
    const stats = new Map<string, ChangeStats>()
    for (const [id, entry] of entries) if (entry.stats) stats.set(id, entry.stats)
    return stats
  }, [entries])
}

function parkedByHand(threads: WorkThread[], keys: readonly string[]): WorkThread[] {
  return threads.map((t) => (keys.includes(t.key) ? { ...t, parked: true } : t))
}

/** The threads worth showing: parked ones marked so, dismissed ones left out. */
function shownThreads(
  input: WorkThreadInput,
  parkedKeys: readonly string[],
  dismissed: Record<string, number>
): WorkThread[] {
  return parkedByHand(buildWorkThreads(input), parkedKeys).filter(
    (t) => !isDismissed(dismissed, t.key)
  )
}

/** Home's work threads, joined from sessions, extension facets and tickets; the clock ticks each minute. */
export function useWorkThreads(): WorkThreads {
  const facts = useSessionFacts()
  const facets = useHomeFeedStore((s) => s.facets)
  const parkedKeys = useParkedThreads((s) => s.keys)
  const dismissed = useDismissedThreads((s) => s.dismissed)
  const now = useNow(MINUTE_MS)
  const repoRoots = useRepoRoots()
  const issues = useIssues()
  const projectIds = useMemo(
    () => [...new Set(facts.flatMap((f) => (f.isClosed || !f.projectId ? [] : [f.projectId])))],
    [facts]
  )
  const changeStats = useChangeStats(projectIds)

  const result = useMemo(() => {
    const input: WorkThreadInput = { facts, facets, issues, changeStats, repoRoots, now }
    // `allThreads` keeps dismissed threads so a Focus item's done check still sees the work.
    const threads = shownThreads(input, parkedKeys, dismissed)
    return {
      threads,
      groups: groupThreads(threads),
      allThreads: parkedByHand(allWorkThreads(input), parkedKeys),
    }
  }, [facts, facets, issues, changeStats, repoRoots, now, parkedKeys, dismissed])
  useEffect(() => {
    const live = new Set(result.allThreads.map((t) => t.key))
    useParkedThreads.getState().forgetGone(live, Date.now())
    useDismissedThreads.getState().forgetGone(live, Date.now())
  }, [result.allThreads])
  return result
}
