import { create } from 'zustand'
import type { TaskLane } from '../../../shared/schemas/tasks.schema'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { laneOf } from '../../sidebar/task-groups'

/** The lane the Add to task picker is open for; null while it is closed. */
export const useAddToTaskStore = create<{
  lane: TaskLane | null
  open: (lane: TaskLane) => void
  close: () => void
}>((set) => ({
  lane: null,
  open: (lane) => set({ lane }),
  close: () => set({ lane: null }),
}))

/** Opens the picker for one lane: a sidebar branch, a terminal tab, an Overview tile or a Home row. */
export function openAddToTask(lane: { repoRoot: string; branch: string }): void {
  useAddToTaskStore.getState().open({ repoRoot: lane.repoRoot, branch: lane.branch })
}

/** The repo folder and branch of a sidebar branch; null when it is not one, such as scratch. */
export function laneOfBranch(projectId: string | null | undefined): TaskLane | null {
  const workspaces = useWorkspaceStore.getState()
  const project = [...workspaces.projectsByWorkspaceId.values()]
    .flat()
    .find((p) => p.id === projectId)
  const workspace = workspaces.workspaces.find((w) => w.id === project?.workspaceId)
  return project && workspace ? laneOf(project, workspace) : null
}
