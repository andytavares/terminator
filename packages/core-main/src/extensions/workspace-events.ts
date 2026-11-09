type ProjectDeleteHandler = (projectId: string) => void

const projectDeleteHandlers = new Set<ProjectDeleteHandler>()

export function onProjectDelete(handler: ProjectDeleteHandler): () => void {
  projectDeleteHandlers.add(handler)
  return () => projectDeleteHandlers.delete(handler)
}

export function emitProjectDelete(projectId: string): void {
  projectDeleteHandlers.forEach((h) => h(projectId))
}
