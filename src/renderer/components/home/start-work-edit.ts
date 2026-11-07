import { useWorkspaceStore } from '../../stores/workspace.store'
import { askBranchName, type RunAs } from './start-work'
import { GLOBAL_CHOICE, type LauncherTab } from './start-work-model'
import { runTime, startingWhen, type WhenValue } from './WhenChoices'
import { promptBranch } from '../../../shared/home/branch-name'
import type { Schedule, ScheduleInput } from '../../../shared/schemas/schedules.schema'
import type { Workspace } from '../../../shared/types/index'

// Saving a prompt to run later from Start work, new or edited.

/** Today, or tomorrow once `time` has passed: the first day a one-time run can still happen. */
const firstDayFor = (time: string): string => {
  const now = new Date()
  const [hours, minutes] = time.split(':').map(Number)
  const passed = now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes
  if (passed) now.setDate(now.getDate() + 1)
  return now.toLocaleDateString('sv-SE')
}

/** What the launcher opens with: a blank launcher, or the scheduled run being edited. */
export function startingFields(prefill: string, editing: Schedule | null) {
  if (editing === null)
    return {
      ...{ tab: 'tickets' as LauncherTab, query: prefill, runAs: 'agent' as RunAs },
      ...{ agentId: null as string | null, pickedRepoId: null as string | null },
      ...{ when: startingWhen(firstDayFor('09:00')), useRepoFolder: false },
    }
  const workspace = useWorkspaceStore
    .getState()
    .workspaces.find((w) => w.folderPath === editing.repoRoot)
  const saved = startingWhen(editing.date ?? firstDayFor(editing.time))
  return {
    ...{ tab: 'prompt' as LauncherTab, query: editing.prompt, runAs: editing.runAs },
    agentId: editing.agentId,
    pickedRepoId: editing.repoRoot === null ? GLOBAL_CHOICE : (workspace?.id ?? null),
    when: { ...saved, when: editing.kind, time: editing.time, rule: editing.repeat ?? saved.rule },
    useRepoFolder: !editing.newWorktree,
  }
}

export interface SaveView {
  query: string
  runAs: RunAs
  agentId: string | null
  when: WhenValue
  /** Null for a global scheduled run. */
  repo: Workspace | null
  ownBranch: boolean
  agentBranch: string | null
  useRepoFolder: boolean
  editing: Schedule | null
}

/** An edit keeps its branch while it stays in the same workspace and the same kind of checkout. */
function keptBranch({ editing, repo, useRepoFolder }: SaveView): string | null {
  if (editing === null) return null
  const sameRepo = (repo?.folderPath ?? null) === editing.repoRoot
  return sameRepo && useRepoFolder === !editing.newWorktree ? editing.branch : null
}

/** The one branch a repeat runs on, named once on save; null when it runs in the repo folder. */
async function repeatBranch(view: SaveView): Promise<string | null> {
  if (!view.ownBranch) return null
  const text = view.query.trim()
  return view.agentBranch ?? (await askBranchName(text)) ?? promptBranch(text)
}

const whenFields = (when: WhenValue) =>
  when.when === 'repeat'
    ? { kind: 'repeat' as const, repeat: when.rule, date: null }
    : { kind: 'once' as const, repeat: null, date: when.date }

async function scheduleInput(view: SaveView): Promise<ScheduleInput> {
  const fields = whenFields(view.when)
  return {
    ...fields,
    repoRoot: view.repo?.folderPath ?? null,
    prompt: view.query.trim(),
    runAs: view.runAs,
    branch: fields.kind === 'repeat' ? (keptBranch(view) ?? (await repeatBranch(view))) : null,
    time: runTime(view.when),
    newWorktree: view.ownBranch,
    agentId: view.agentId,
  }
}

/** Saves the prompt to run later, or the edit of a saved one. Null when saved; else what to say. */
export async function saveSchedule(view: SaveView): Promise<string | null> {
  const input = await scheduleInput(view)
  const { schedules } = window.electronAPI
  const result =
    view.editing === null
      ? await schedules.create(input)
      : await schedules.update({ id: view.editing.id, ...input })
  return 'data' in result ? null : result.message
}
