import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useExtensionRegistry } from '../extensions/registry'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'

/** Leaves Home or the wall and shows one session in its terminal, switching workspace if it must. */
export function navigateToSession(sessionId: string): void {
  const session = useSessionStore.getState().sessions.get(sessionId)
  if (session === undefined) return
  useExtensionRegistry.getState().setActiveGlobalTab(null)

  const workspaces = useWorkspaceStore.getState()
  if (session.projectId === SCRATCH_PROJECT_ID) {
    useSessionStore.getState().setActiveSessionForProject(SCRATCH_PROJECT_ID, sessionId)
    workspaces.setScratchActive(true)
    return
  }
  const project = [...workspaces.projectsByWorkspaceId.values()]
    .flat()
    .find((p) => p.id === session.projectId)
  if (project === undefined) return
  if (project.workspaceId !== workspaces.activeWorkspaceId) {
    workspaces.setActiveWorkspace(project.workspaceId)
  }
  workspaces.setActiveProject(project.id)
  useSessionStore.getState().setActiveSessionForProject(project.id, sessionId)
}
