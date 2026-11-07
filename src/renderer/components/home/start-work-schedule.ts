import { useEffect } from 'react'
import { useToastStore } from '../../stores/toast.store'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { globalStartFailure, startWork } from './start-work'
import { startGlobalPrompt } from '../../terminal/start-session'
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

/** The session each global scheduled run last opened, by schedule id, to check overlap against. */
const lastGlobalSessions = new Map<string, string>()

/** Starts a global scheduled run in Scratch. Null when it started or was skipped; otherwise why not. */
async function launchGlobal(schedule: Schedule): Promise<string | null> {
  const last = useSessionStore.getState().sessions.get(lastGlobalSessions.get(schedule.id) ?? '')
  if (schedule.repeat?.overlap === 'skip' && last !== undefined && last.status !== 'closed')
    return null
  const { prompt: text, runAs } = schedule
  const sessionId = await startGlobalPrompt({
    text,
    runAs,
    ...(schedule.agentId === null ? {} : { agentId: schedule.agentId }),
  })
  if (sessionId === null) return globalStartFailure(text, runAs)
  lastGlobalSessions.set(schedule.id, sessionId)
  return null
}

async function launchScheduled(schedule: Schedule): Promise<void> {
  const message =
    schedule.repoRoot === null ? await launchGlobal(schedule) : await launchInWorkspace(schedule)
  if (message !== null)
    useToastStore
      .getState()
      .addToast({ type: 'error', message: `A scheduled run did not start. ${message}` })
}

/** Starts a scheduled run in its workspace. Null when it started or was skipped; otherwise why not. */
async function launchInWorkspace(schedule: Schedule): Promise<string | null> {
  const workspace = useWorkspaceStore
    .getState()
    .workspaces.find((w) => w.folderPath === schedule.repoRoot)
  // shortcut: a schedule with no branch (the repo folder) never checks overlap, add it if repeats pile up there.
  const overlaps =
    workspace !== undefined &&
    schedule.branch !== null &&
    schedule.repeat?.overlap === 'skip' &&
    isStillRunning(workspace.id, schedule.branch)
  if (overlaps) return null
  return workspace === undefined
    ? `${schedule.repoRoot} is not a workspace any more.`
    : startWork({
        kind: 'prompt',
        text: schedule.prompt,
        workspace,
        runAs: schedule.runAs,
        newWorktree: schedule.newWorktree,
        ...(schedule.branch === null ? {} : { branch: schedule.branch }),
        ...(schedule.agentId === null ? {} : { agentId: schedule.agentId }),
      })
}

/** Main says a schedule is due; this window starts it. */
export function useScheduledRuns(): void {
  useEffect(
    // The remote browser client has no schedules API (manifest `remote: 'omit'`).
    () => window.electronAPI.schedules?.onRun?.((schedule) => void launchScheduled(schedule)),
    []
  )
}
