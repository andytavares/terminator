import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { TerminalInstance } from '../components/terminal/TerminalSession'

export function useTerminalSession() {
  const {
    createSession: storeCreateSession,
    closeSession,
    getSessionsForProject,
    setTerminalInstance,
    setActiveSessionForProject,
    incrementBellCount,
  } = useSessionStore()

  async function createSession(
    projectId: string,
    type: 'human' | 'agent',
    title: string,
    cwd: string,
    scrollbackLimit: number
  ): Promise<string> {
    const sessionId = await storeCreateSession(projectId, type, title, cwd, scrollbackLimit)
    const instance = new TerminalInstance(sessionId, scrollbackLimit, () => {
      const { activeProjectId } = useWorkspaceStore.getState()
      const { activeSessionIdByProject, sessions } = useSessionStore.getState()
      const session = sessions.get(sessionId)
      if (!session) return
      const isActiveSession = activeSessionIdByProject.get(session.projectId) === sessionId
      const isActiveProject = activeProjectId === session.projectId
      if (isActiveSession && isActiveProject) return
      incrementBellCount(sessionId)
    })
    // Store the instance first, then activate — TerminalPane's effect fires after
    // both updates land so getTerminalInstance() is guaranteed to return the instance.
    setTerminalInstance(sessionId, instance)
    setActiveSessionForProject(projectId, sessionId)
    return sessionId
  }

  return {
    createSession,
    closeSession,
    getSessionsForProject,
  }
}
