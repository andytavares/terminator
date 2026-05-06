import { useSessionStore } from '../stores/session.store'
import { TerminalInstance } from '../components/terminal/TerminalSession'

export function useTerminalSession() {
  const {
    createSession: storeCreateSession,
    closeSession,
    getSessionsForProject,
    setTerminalInstance,
    setActiveSessionForProject,
  } = useSessionStore()

  async function createSession(
    projectId: string,
    type: 'human' | 'agent',
    title: string,
    cwd: string,
    scrollbackLimit: number
  ): Promise<string> {
    const sessionId = await storeCreateSession(projectId, type, title, cwd, scrollbackLimit)
    const instance = new TerminalInstance(sessionId, scrollbackLimit)
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
