import { useTaskStore } from '../stores/task.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { laneSwitchOf } from '../sidebar/task-groups'
import { revealBranch } from './reveal-branch'

/** Shows lane `lane` (from 0) of the task the visible branch is in, as the lane switcher's button does. */
export function switchLane(lane: number): void {
  const { activeProjectId, scratchActive, workspaces, projectsByWorkspaceId } =
    useWorkspaceStore.getState()
  if (scratchActive || activeProjectId === null) return
  const switcher = laneSwitchOf(activeProjectId, useTaskStore.getState().tasks, {
    workspaces,
    projects: projectsByWorkspaceId,
  })
  const target = switcher?.lanes[lane]?.projectId
  if (target) revealBranch(target)
}
