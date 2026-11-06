import { useEffect } from 'react'
import { useToastStore } from '../../stores/toast.store'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { startWork } from './start-work'
import type { Schedule } from '../../../shared/schemas/schedules.schema'

// A saved prompt coming due starts the way Start work starts a typed prompt.

export type When = 'now' | 'once' | 'repeat'

/** True while a session of the schedule's branch is open, so its next run would overlap it. */
function isStillRunning(workspaceId: string, branch: string): boolean {
  const project = (useWorkspaceStore.getState().projectsByWorkspaceId.get(workspaceId) ?? []).find(
    (p) => p.gitBranch === branch
  )
  return [...useSessionStore.getState().sessions.values()].some(
    (s) => s.projectId === project?.id && s.status !== 'closed'
  )
}

async function launchScheduled(schedule: Schedule): Promise<void> {
  const workspace = useWorkspaceStore
    .getState()
    .workspaces.find((w) => w.folderPath === schedule.repoRoot)
  // shortcut: a schedule with no branch (the repo folder) never checks overlap, add it if repeats pile up there.
  const overlaps =
    workspace !== undefined &&
    schedule.branch !== null &&
    schedule.repeat?.overlap === 'skip' &&
    isStillRunning(workspace.id, schedule.branch)
  if (overlaps) return
  const message =
    workspace === undefined
      ? `${schedule.repoRoot} is not a workspace any more.`
      : await startWork({
          kind: 'prompt',
          text: schedule.prompt,
          workspace,
          runAs: schedule.runAs,
          newWorktree: schedule.newWorktree,
          ...(schedule.branch === null ? {} : { branch: schedule.branch }),
          ...(schedule.agentId === null ? {} : { agentId: schedule.agentId }),
        })
  if (message !== null)
    useToastStore
      .getState()
      .addToast({ type: 'error', message: `A scheduled run did not start. ${message}` })
}

/** Main says a schedule is due; this window starts it. */
export function useScheduledRuns(): void {
  useEffect(
    // The remote browser client has no schedules API (manifest `remote: 'omit'`).
    () => window.electronAPI.schedules?.onRun?.((schedule) => void launchScheduled(schedule)),
    []
  )
}
