import { useCallback, useEffect, useState } from 'react'
import { describeRepeat, nextRuns } from '../../../shared/recurrence'
import { useToastStore } from '../../stores/toast.store'
import { useStartWorkStore } from './start-work'
import { dayLabel } from './WhenChoices'
import type { Schedule } from '../../../shared/schemas/schedules.schema'
import type { Workspace } from '../../../shared/types/index'

// The saved scheduled runs, for Home's Scheduled view and Start work's count of them.

/** "1 scheduled run", "5 scheduled runs". */
export const scheduledRunCount = (count: number): string =>
  `${count} scheduled run${count === 1 ? '' : 's'}`

/** "every weekday at 09:00", or "once on Tue 1 Dec at 16:00". */
export function whenOf(schedule: Schedule): string {
  if (schedule.repeat !== null) return describeRepeat(schedule.repeat, schedule.time)
  return `once on ${dayLabel(new Date(`${schedule.date}T${schedule.time}`))} at ${schedule.time}`
}

/** When it runs next after `now`; null when paused or when a one-time run's time has passed. */
export function nextRunOf(schedule: Schedule, now: Date): Date | null {
  if (schedule.paused) return null
  if (schedule.repeat === null) {
    const at = new Date(`${schedule.date}T${schedule.time}`)
    return at > now ? at : null
  }
  // The scheduler counts a repeat from when it was created.
  const plan = { rule: schedule.repeat, time: schedule.time, anchor: new Date(schedule.createdAt) }
  return nextRuns(plan, now, 1)[0] ?? null
}

/** The run that comes next of all of them, and when; null when none will run. */
export function soonestRun(
  runs: readonly Schedule[],
  now: Date
): { schedule: Schedule; at: Date } | null {
  let soonest: { schedule: Schedule; at: Date } | null = null
  for (const schedule of runs) {
    const at = nextRunOf(schedule, now)
    if (at !== null && (soonest === null || at < soonest.at)) soonest = { schedule, at }
  }
  return soonest
}

export interface RunGroup {
  /** The workspace folder, or 'global'. */
  id: string
  name: string
  global: boolean
  runs: Schedule[]
}

const folderName = (folderPath: string): string => folderPath.split('/').pop() ?? folderPath

/** Global runs first, then each workspace's by its name; a folder with no workspace by its folder name. */
export function groupRuns(runs: readonly Schedule[], workspaces: readonly Workspace[]): RunGroup[] {
  const groups = new Map<string, RunGroup>()
  for (const schedule of runs) {
    const id = schedule.repoRoot ?? 'global'
    const name =
      schedule.repoRoot === null
        ? 'Global'
        : (workspaces.find((w) => w.folderPath === schedule.repoRoot)?.name ??
          folderName(schedule.repoRoot))
    const group = groups.get(id) ?? { id, name, global: schedule.repoRoot === null, runs: [] }
    group.runs.push(schedule)
    groups.set(id, group)
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.global) - Number(a.global) || a.name.localeCompare(b.name)
  )
}

type Reply = { data: unknown } | { error: string; message: string }

/** Calls a schedules channel; a refusal shows as a toast in plain words. */
async function act(call: Promise<Reply>, failure: string): Promise<void> {
  if (!('data' in (await call)))
    useToastStore.getState().addToast({ type: 'error', message: failure })
}

/** The saved runs, read again when one comes due and when Start work opens or closes. */
function useRunsList(): [Schedule[] | null, () => Promise<void>] {
  const [runs, setRuns] = useState<Schedule[] | null>(null)
  const launcherOpen = useStartWorkStore((s) => s.open)
  const read = useCallback(
    () =>
      window.electronAPI.schedules.list().then((answer) => {
        if ('data' in answer) setRuns(answer.data)
      }),
    []
  )
  useEffect(() => {
    void read()
  }, [read, launcherOpen])
  // The remote browser client has no schedules API (manifest `remote: 'omit'`).
  useEffect(() => window.electronAPI.schedules.onRun?.(() => void read()), [read])
  return [runs, read]
}

/** The saved runs and what can be done to each; the list is read again after each action. */
export function useSavedRuns() {
  const [runs, read] = useRunsList()
  const after = async (call: Promise<Reply>, failure: string): Promise<void> => {
    await act(call, failure)
    await read()
  }
  const { schedules } = window.electronAPI
  return {
    runs,
    runNow: (s: Schedule) =>
      after(schedules.runNow({ id: s.id }), `${s.prompt} could not be started now.`),
    setPaused: (s: Schedule, paused: boolean) =>
      after(
        schedules.pause({ id: s.id, paused }),
        `${s.prompt} could not be ${paused ? 'paused' : 'resumed'}.`
      ),
    remove: (s: Schedule) =>
      after(schedules.delete({ id: s.id }), `${s.prompt} could not be removed.`),
    edit: (s: Schedule) => useStartWorkStore.getState().openLauncher('', s),
  }
}
