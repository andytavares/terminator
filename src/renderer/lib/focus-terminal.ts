import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'

/**
 * Puts the keyboard back in the terminal the user was last in. The project's
 * activeSessionId survives while an extension surface is showing, so there is
 * no separate history to consult — it is still the session they left.
 */
export function focusActiveTerminal(): void {
  const { activeProjectId, scratchActive } = useWorkspaceStore.getState()
  const projectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
  if (!projectId) return

  const session = useSessionStore.getState()
  const sessionId =
    session.getFocusedSession(projectId) ?? session.getActiveSessionForProject(projectId)
  if (!sessionId) return

  session.getTerminalInstance(sessionId)?.terminal.focus()
}
