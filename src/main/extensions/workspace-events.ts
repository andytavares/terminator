type WorkspaceDeleteHandler = (workspaceId: string) => void
type ProjectDeleteHandler = (projectId: string) => void

const workspaceDeleteHandlers = new Set<WorkspaceDeleteHandler>()
const projectDeleteHandlers = new Set<ProjectDeleteHandler>()

export function onWorkspaceDelete(handler: WorkspaceDeleteHandler): () => void {
  workspaceDeleteHandlers.add(handler)
  return () => workspaceDeleteHandlers.delete(handler)
}

export function onProjectDelete(handler: ProjectDeleteHandler): () => void {
  projectDeleteHandlers.add(handler)
  return () => projectDeleteHandlers.delete(handler)
}

export function emitWorkspaceDelete(workspaceId: string): void {
  workspaceDeleteHandlers.forEach((h) => h(workspaceId))
}

export function emitProjectDelete(projectId: string): void {
  projectDeleteHandlers.forEach((h) => h(projectId))
}
