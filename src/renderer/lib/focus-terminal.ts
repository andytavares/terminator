import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'

/**
 * Puts the keyboard back in the terminal the user was last in. The project's
 * activeSessionId survives while an extension surface is showing, so there is
 * no separate history to consult — it is still the session they left.
 */
export function focusActiveTerminal(): void {
  const sessionId = focusedTerminalSessionId()
  if (!sessionId) return
  useSessionStore.getState().getTerminalInstance(sessionId)?.terminal.focus()
}

/** The terminal the keyboard is in: the focused pane, else the tab showing, of what is on screen. */
export function focusedTerminalSessionId(): string | null {
  const { activeProjectId, scratchActive } = useWorkspaceStore.getState()
  const projectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
  if (!projectId) return null
  const session = useSessionStore.getState()
  return session.getFocusedSession(projectId) ?? session.getActiveSessionForProject(projectId)
}
