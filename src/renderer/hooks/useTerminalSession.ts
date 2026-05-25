import { useCallback } from 'react'
import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { TerminalInstance } from '../components/terminal/TerminalSession'
import type { PaneSplitDirection } from '../../../shared/types/index'

export function useTerminalSession() {
  const {
    createSession: storeCreateSession,
    setTerminalInstance,
    setActiveSessionForProject,
    incrementBellCount,
    activateSplit,
    getFocusedSession,
    getActiveSessionForProject,
  } = useSessionStore()

  const createSession = useCallback(
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
        const tabTitle = useSessionStore.getState().sessions.get(sessionId)?.tabTitle ?? 'Terminal'
        window.electronAPI.notification.show('Terminator', `${tabTitle} needs attention`)
      })
      // Store the instance first, then activate — TerminalPane's effect fires after
      // both updates land so getTerminalInstance() is guaranteed to return the instance.
      setTerminalInstance(sessionId, instance)
      setActiveSessionForProject(projectId, sessionId)
      return sessionId
    },
    [storeCreateSession, setTerminalInstance, setActiveSessionForProject, incrementBellCount]
  )

  const splitSession = useCallback(
    async function splitSession(
      projectId: string,
      direction: PaneSplitDirection,
      cwd: string,
      scrollbackLimit: number
    ): Promise<void> {
      const focusedId = getFocusedSession(projectId) ?? getActiveSessionForProject(projectId)
      if (!focusedId) return

      const sessionId = await storeCreateSession(projectId, 'human', '', cwd, scrollbackLimit)
      const instance = new TerminalInstance(sessionId, scrollbackLimit, () => {
        incrementBellCount(sessionId)
        const tabTitle = useSessionStore.getState().sessions.get(sessionId)?.tabTitle ?? 'Terminal'
        window.electronAPI.notification.show('Terminator', `${tabTitle} needs attention`)
      })
      setTerminalInstance(sessionId, instance)
      activateSplit(projectId, focusedId, sessionId, direction)
    },
    [
      storeCreateSession,
      setTerminalInstance,
      activateSplit,
      getFocusedSession,
      getActiveSessionForProject,
      incrementBellCount,
    ]
  )

  return { createSession, splitSession }
}
