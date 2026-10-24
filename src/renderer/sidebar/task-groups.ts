import type { Project, Workspace } from '../../shared/types/index'
import type { Task, TaskLane } from '../../shared/schemas/tasks.schema'
import { branchLabel } from './branch-display'
import type { BranchRow, RepoGroup } from './branch-rows'

// The sidebar grouped by task: pure, like the rest of this directory. It takes the
// repo groups the list is already built from and moves each task's branches out of them.

/** One lane of a task as the sidebar draws it: the branch row, and the repo it is in. */
interface TaskSectionLane {
  repoName: string
  row: BranchRow
}

export interface TaskSection {
  task: Task
  lanes: TaskSectionLane[]
  needsYou: boolean
}

/** The repo folder and branch a stored task names a branch by. */
export function laneOf(project: Project, workspace: Workspace): TaskLane {
  return { repoRoot: workspace.folderPath, branch: branchLabel(project) }
}

function findLaneRow(repos: readonly RepoGroup[], lane: TaskLane) {
  const repo = repos.find((r) => r.folderPath === lane.repoRoot)
  const row = repo?.branches.find((b) => b.label === lane.branch)
  return repo && row ? { repoName: repo.label, row } : undefined
}

function sectionOf(task: Task, repos: readonly RepoGroup[]): TaskSection | undefined {
  const lanes = task.lanes.flatMap((lane) => findLaneRow(repos, lane) ?? [])
  if (lanes.length === 0) return undefined
  return { task, lanes, needsYou: lanes.some((l) => l.row.state === 'awaiting-input') }
}

/** The repos without the branches a task took, and without a header left with nothing under it. */
function withoutTaskBranches(repos: readonly RepoGroup[], taken: Set<string>): RepoGroup[] {
  return repos
    .map((repo) => {
      const branches = repo.branches.filter((b) => !taken.has(b.projectId))
      return { ...repo, branches, branchCount: branches.length }
    })
    .filter((repo) => repo.branches.length > 0)
}

/**
 * Each live task with the branches it holds, and the repos with the branches no task holds.
 * An archived task is not drawn, so its branches stay under their repos.
 */
export function groupByTask(
  repos: readonly RepoGroup[],
  tasks: readonly Task[]
): { sections: TaskSection[]; rest: RepoGroup[] } {
  const sections = tasks
    .filter((task) => task.archivedAt === null)
    .flatMap((task) => sectionOf(task, repos) ?? [])
  const taken = new Set(sections.flatMap((s) => s.lanes.map((l) => l.row.projectId)))
  return { sections, rest: withoutTaskBranches(repos, taken) }
}

/** One lane of the task the visible branch is in, with the branch it opens. */
export interface SwitchLane {
  repoName: string
  /** The branch to select; null when this lane's branch is not in the sidebar. */
  projectId: string | null
}

export interface LaneSwitch {
  title: string
  lanes: SwitchLane[]
  /** The visible branch's lane. */
  current: number
}

function switchLaneOf(
  lane: TaskLane,
  workspaces: readonly Workspace[],
  projects: ReadonlyMap<string, Project[]>
): SwitchLane {
  const workspace = workspaces.find((w) => w.folderPath === lane.repoRoot)
  const project =
    workspace && projects.get(workspace.id)?.find((p) => branchLabel(p) === lane.branch)
  return { repoName: workspace?.name ?? lane.repoRoot, projectId: project?.id ?? null }
}

/**
 * The lanes to switch between when the visible branch is in a live task with two or more;
 * null for a branch in no task or in a task of one lane, where there is nothing to switch to.
 */
export function laneSwitchOf(
  visibleProjectId: string,
  tasks: readonly Task[],
  repos: { workspaces: readonly Workspace[]; projects: ReadonlyMap<string, Project[]> }
): LaneSwitch | null {
  const lanes = (task: Task) =>
    task.lanes.map((l) => switchLaneOf(l, repos.workspaces, repos.projects))
  for (const task of tasks.filter((t) => t.archivedAt === null && t.lanes.length >= 2)) {
    const switchLanes = lanes(task)
    const current = switchLanes.findIndex((l) => l.projectId === visibleProjectId)
    if (current !== -1) return { title: task.title, lanes: switchLanes, current }
  }
  return null
}
