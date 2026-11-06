import { useEffect } from 'react'
import { useToastStore } from '../../stores/toast.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { startWork } from './start-work'
import type { Schedule } from '../../../shared/schemas/schedules.schema'

// A saved prompt coming due starts the way Start work starts a typed prompt.

export type When = 'now' | 'once' | 'daily' | 'weekdays'

async function launchScheduled(schedule: Schedule): Promise<void> {
  const workspace = useWorkspaceStore
    .getState()
    .workspaces.find((w) => w.folderPath === schedule.repoRoot)
  const message =
    workspace === undefined
      ? `${schedule.repoRoot} is not a workspace any more.`
      : await startWork({
          kind: 'prompt',
          text: schedule.prompt,
          workspace,
          runAs: schedule.runAs,
          newWorktree: schedule.newWorktree,
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
