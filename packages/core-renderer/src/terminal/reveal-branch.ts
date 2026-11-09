import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useExtensionRegistry } from '../extensions/registry'
import { agentStateOf } from '../sidebar/agent-state'
import { terminalToFocus } from '../components/sidebar/branch-actions'
import { revealSession } from './navigate-to-session'

// Shows a branch as a click on its sidebar row does: the terminal waiting on you, else the one
// last open there. A branch with none is selected, and the app opens its first.
export function revealBranch(projectId: string): void {
  const sessions = [...useSessionStore.getState().sessions.values()].map((s) => ({
    ...s,
    agentState: agentStateOf(s),
  }))
  const terminal = terminalToFocus(sessions, projectId)
  if (terminal !== undefined) {
    revealSession(terminal)
    return
  }
  const workspaces = useWorkspaceStore.getState()
  const project = [...workspaces.projectsByWorkspaceId.values()]
    .flat()
    .find((p) => p.id === projectId)
  if (project === undefined) return
  const registry = useExtensionRegistry.getState()
  registry.setActiveGlobalTab(null)
  registry.setActiveWorkspaceTab(null)
  registry.setActiveProjectTab(null)
  workspaces.setActiveWorkspace(project.workspaceId)
  workspaces.setActiveProject(project.id)
}
