import { useWorkspaceStore } from '../../stores/workspace.store'
import { branchLabel } from '../../sidebar/branch-display'
import { SCRATCH_PROJECT_ID } from '../../../shared/types/index'

export interface Place {
  label: string
  color?: string
}

/** The workspace and branch a terminal belongs to, as the header names them. */
export function usePlaceOf(projectId: string): Place | null {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWorkspaceId = useWorkspaceStore((s) => s.projectsByWorkspaceId)
  if (projectId === SCRATCH_PROJECT_ID) return { label: 'Scratch' }
  for (const [workspaceId, projects] of projectsByWorkspaceId) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) continue
    const workspace = workspaces.find((w) => w.id === workspaceId)
    const branch = branchLabel(project)
    return { label: workspace ? `${workspace.name} · ${branch}` : branch, color: workspace?.color }
  }
  return null
}
