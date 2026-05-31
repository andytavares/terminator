import { useCallback } from 'react'
import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useNotificationStore } from '../stores/notification.store'
import { TerminalInstance } from '../components/terminal/TerminalSession'
import type { PaneSplitDirection } from '../../../shared/types/index'

function makeBellHandler(sessionId: string, incrementBellCount: (id: string) => void): () => void {
  return () => {
    const { activeProjectId } = useWorkspaceStore.getState()
    const { activeSessionIdByProject, sessions } = useSessionStore.getState()
    const session = sessions.get(sessionId)
    if (!session) return
    const isActiveSession = activeSessionIdByProject.get(session.projectId) === sessionId
    const isActiveProject = activeProjectId === session.projectId
    if (isActiveSession && isActiveProject) return
    incrementBellCount(sessionId)
    const tabTitle = useSessionStore.getState().sessions.get(sessionId)?.tabTitle ?? 'Terminal'
    const title = 'Terminator'
    const body = `${tabTitle} needs attention`
    window.electronAPI.notification.show(title, body)
    useNotificationStore.getState().addNotification({
      id: `bell-${sessionId}-${Date.now()}`,
      type: 'info',
      title,
      message: body,
      timestamp: Date.now(),
    })
  }
}

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
      const instance = new TerminalInstance(
        sessionId,
        scrollbackLimit,
        makeBellHandler(sessionId, incrementBellCount)
      )
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
      const instance = new TerminalInstance(
        sessionId,
        scrollbackLimit,
        makeBellHandler(sessionId, incrementBellCount)
      )
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
