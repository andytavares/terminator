import { useMemo } from 'react'
import { useTaskStore } from '../../stores/task.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { Task, TaskLane } from '../../../shared/schemas/tasks.schema'
import type { Project, Workspace } from '../../../shared/types/index'

// What the Add to task picker and the task drawer decide, apart from how it is drawn.

/** A branch card the sidebar shows, as the lane it would be and the repo's name. */
export interface LaneCard {
  lane: TaskLane
  repoName: string
}

export const sameLane = (a: TaskLane, b: TaskLane): boolean =>
  a.repoRoot === b.repoRoot && a.branch === b.branch

export const holdsLane = (task: Task, lane: TaskLane): boolean =>
  task.lanes.some((held) => sameLane(held, lane))

function cardsOf(workspace: Workspace, projects: readonly Project[]): LaneCard[] {
  return projects.flatMap((project) =>
    project.gitBranch === undefined
      ? []
      : [
          {
            lane: { repoRoot: workspace.folderPath, branch: project.gitBranch },
            repoName: workspace.name,
          },
        ]
  )
}

/** Every branch card of every repo in the sidebar. */
export function useLaneCards(): LaneCard[] {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWorkspaceId = useWorkspaceStore((s) => s.projectsByWorkspaceId)
  return useMemo(
    () => workspaces.flatMap((w) => cardsOf(w, projectsByWorkspaceId.get(w.id) ?? [])),
    [workspaces, projectsByWorkspaceId]
  )
}

/** The other repos' cards on a branch of the same name: a strong hint they belong together. */
export function sameNameCards(cards: readonly LaneCard[], lane: TaskLane): LaneCard[] {
  return cards.filter((c) => c.lane.branch === lane.branch && c.lane.repoRoot !== lane.repoRoot)
}

/** Tasks still open (not archived, not done) whose title contains what was typed. */
export function openTasksMatching(tasks: readonly Task[], typed: string): Task[] {
  const needle = typed.trim().toLowerCase()
  return tasks.filter(
    (t) => t.archivedAt === null && t.doneAt === null && t.title.toLowerCase().includes(needle)
  )
}

/** Adds each lane to the task in turn; false as soon as one is refused. */
export async function addLanesToTask(taskId: string, lanes: readonly TaskLane[]): Promise<boolean> {
  for (const lane of lanes) {
    if (!(await useTaskStore.getState().addLane(taskId, lane))) return false
  }
  return true
}

/** A new task named after the branch of its first lane. */
export function createTaskFrom(lanes: readonly TaskLane[]): Promise<boolean> {
  return useTaskStore.getState().create({ title: lanes[0].branch, lanes: [...lanes] })
}
