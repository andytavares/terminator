import { useEffect, useMemo, useRef } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useTaskStore } from '../../stores/task.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { useSessionFacts } from '../session/useSessionFacts'
import { useNow } from '../session/useNow'
import { useParkedThreads } from './parked-threads'
import { useWorkMarks } from '../../home/work-marks'
import { isSettled, wokenKeys, type WorkMarks } from '../../home/settle'
import {
  allWorkThreads,
  buildWorkThreads,
  groupThreads,
  type ThreadGroup,
  type WorkThread,
  type WorkThreadInput,
} from '../../home/work-threads'
import type { TaskState } from '../../home/task-state'
import type { ChangeStats } from '../../../../core-shared/src/schemas/git.schema'
import type { Issue } from '../../../../core-shared/src/types/index'

const MINUTE_MS = 60_000

export interface WorkThreads {
  /** The work worth showing, including what the operator parked by hand. */
  threads: WorkThread[]
  groups: ThreadGroup[]
  /** Every thread, finished ones too; a Focus item reads a shipped thread from here. */
  allThreads: WorkThread[]
  /** The rows Home would show but the Inbox settles: by hand, snoozed, or quiet for a day. */
  settledThreads: WorkThread[]
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

/** Each repo's name and colour by its folder, so a lane with nothing open still says which repo. */
function useRepos(): Map<string, { name: string; color: string | null }> {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  return useMemo(
    () => new Map(workspaces.map((w) => [w.folderPath, { name: w.name, color: w.color }])),
    [workspaces]
  )
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
  return threads.map((t) => (keys.includes(t.key) ? { ...t, archived: true } : t))
}

/** The threads worth showing, those parked by hand marked archived, split by the Inbox's settle rule. */
export function shownThreads(
  input: WorkThreadInput,
  parkedKeys: readonly string[],
  marks: WorkMarks
): { threads: WorkThread[]; settledThreads: WorkThread[] } {
  const worth = parkedByHand(buildWorkThreads(input), parkedKeys)
  return {
    threads: worth.filter((t) => !isSettled(t, marks, input.now)),
    settledThreads: worth.filter((t) => isSettled(t, marks, input.now)),
  }
}

/** Wakes settled threads whose agent ended a turn or started asking since the last render. */
export function useWakeOnActivity(threads: readonly WorkThread[]): void {
  const before = useRef<Map<string, TaskState>>(new Map())
  useEffect(() => {
    const woken = wokenKeys(before.current, threads)
    if (woken.length > 0) useWorkMarks.getState().wake(woken)
    before.current = new Map(threads.map((t) => [t.key, t.state]))
  }, [threads])
}

/** Everything the threads are joined from; the clock ticks each minute. */
function useThreadInput(): WorkThreadInput {
  const facts = useSessionFacts()
  const facets = useHomeFeedStore((s) => s.facets)
  const tasks = useTaskStore((s) => s.tasks)
  const now = useNow(MINUTE_MS)
  const repoRoots = useRepoRoots()
  const repos = useRepos()
  const issues = useIssues()
  const projectIds = useMemo(
    () => [...new Set(facts.flatMap((f) => (f.isClosed || !f.projectId ? [] : [f.projectId])))],
    [facts]
  )
  const changeStats = useChangeStats(projectIds)
  return useMemo(
    () => ({ facts, facets, tasks, issues, changeStats, repoRoots, repos, now }),
    [facts, facets, tasks, issues, changeStats, repoRoots, repos, now]
  )
}

/** Home's work threads, joined from sessions, extension facets, tasks and tickets. */
export function useWorkThreads(): WorkThreads {
  const input = useThreadInput()
  const parkedKeys = useParkedThreads((s) => s.keys)
  const settled = useWorkMarks((s) => s.settled)
  const pinned = useWorkMarks((s) => s.pinned)
  const snoozed = useWorkMarks((s) => s.snoozed)
  const result = useMemo(() => {
    // `allThreads` keeps settled threads so a Focus item's done check still sees the work.
    const marks = { settled, pinned, snoozed }
    const { threads, settledThreads } = shownThreads(input, parkedKeys, marks)
    return {
      threads,
      settledThreads,
      groups: groupThreads(threads),
      allThreads: parkedByHand(allWorkThreads(input), parkedKeys),
    }
  }, [input, parkedKeys, settled, pinned, snoozed])
  useWakeOnActivity(result.allThreads)
  useEffect(() => {
    const live = new Set(result.allThreads.map((t) => t.key))
    useParkedThreads.getState().forgetGone(live, Date.now())
    useWorkMarks.getState().forgetGone(live, Date.now())
  }, [result.allThreads])
  return result
}
