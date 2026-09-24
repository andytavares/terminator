import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useExtensionRegistry } from '../extensions/registry'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'

/**
 * Leaves Home, the wall, or any global/workspace/project tab and shows one
 * session in its terminal, switching workspace if it must, then asks the
 * pane to focus it.
 *
 * Every "go to session" path in the app (sidebar click, Quick Actions,
 * notifications, the extension bridge) must go through this one function —
 * a path that only calls setActiveSessionForProject leaves whatever tab was
 * showing on screen and focus on whatever had it.
 */
export function revealSession(sessionId: string): void {
  const session = useSessionStore.getState().sessions.get(sessionId)
  if (session === undefined) return

  const registry = useExtensionRegistry.getState()
  registry.setActiveGlobalTab(null)
  registry.setActiveWorkspaceTab(null)
  registry.setActiveProjectTab(null)

  const workspaces = useWorkspaceStore.getState()
  if (session.projectId === SCRATCH_PROJECT_ID) {
    useSessionStore.getState().setActiveSessionForProject(SCRATCH_PROJECT_ID, sessionId)
    workspaces.setScratchActive(true)
    useSessionStore.getState().requestFocus(sessionId)
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
  useSessionStore.getState().requestFocus(sessionId)
}

/** Back-compat alias: every existing call site keeps working unchanged. */
export const navigateToSession = revealSession
