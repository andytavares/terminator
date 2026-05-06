import React, { useState } from 'react'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { NewTabDialog } from './NewTabDialog'
import './TabBar.css'

interface Props {
  projectId: string
}

export function TabBar({ projectId }: Props): JSX.Element {
  const [newTabOpen, setNewTabOpen] = useState(false)
  const { getSessionsForProject, closeSession, setActiveSessionForProject, getActiveSessionForProject } =
    useSessionStore()
  const { workspaces, activeWorkspaceId } = useWorkspaceStore()
  const sessions = getSessionsForProject(projectId)
  const activeSessionId = getActiveSessionForProject(projectId)
  const wsColor = workspaces.find((w) => w.id === activeWorkspaceId)?.color

  function handleCloseTab(e: React.MouseEvent, sessionId: string): void {
    e.stopPropagation()
    closeSession(sessionId)
  }

  return (
    <div
      className="tab-bar"
      style={wsColor ? { ['--ws-color' as string]: wsColor } : undefined}
    >
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`tab-bar__tab${session.id === activeSessionId ? ' tab-bar__tab--active' : ''}`}
          onClick={() => setActiveSessionForProject(projectId, session.id)}
        >
          <span className="tab-bar__title">{session.tabTitle}</span>
          {session.type === 'agent' && (
            <span className="tab-bar__badge tab-bar__badge--agent">agent</span>
          )}
          <button
            className="tab-bar__close"
            onClick={(e) => handleCloseTab(e, session.id)}
            title="Close tab"
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-bar__new-tab" onClick={() => setNewTabOpen(true)} title="New tab (⌘T)">
        +
      </button>
      {newTabOpen && <NewTabDialog projectId={projectId} onClose={() => setNewTabOpen(false)} />}
    </div>
  )
}
