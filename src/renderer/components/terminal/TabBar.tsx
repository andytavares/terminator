import React, { useState } from 'react'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { AlertBadge } from '../AlertBadge'
import { NewTabDialog } from './NewTabDialog'
import type { ProjectTabRegistration } from '../../extensions/registry'
import './TabBar.css'

interface Props {
  projectId: string
  activeProjectTabId: string | null
  projectTabs: ProjectTabRegistration[]
  onSelectProjectTab: (tabId: string | null) => void
}

export function TabBar({ projectId, activeProjectTabId, projectTabs, onSelectProjectTab }: Props): JSX.Element {
  const [newTabOpen, setNewTabOpen] = useState(false)
  const { getSessionsForProject, closeSession, setActiveSessionForProject, getActiveSessionForProject, getBellCountForSession } =
    useSessionStore()
  const { workspaces, activeWorkspaceId } = useWorkspaceStore()
  const sessions = getSessionsForProject(projectId)
  const activeSessionId = getActiveSessionForProject(projectId)
  const wsColor = workspaces.find((w) => w.id === activeWorkspaceId)?.color
  const isTerminalActive = activeProjectTabId === null

  function handleCloseSession(e: React.MouseEvent, sessionId: string): void {
    e.stopPropagation()
    closeSession(sessionId)
  }

  function handleSessionTabClick(sessionId: string): void {
    setActiveSessionForProject(projectId, sessionId)
  }

  return (
    <div className="tab-bar-stack" style={wsColor ? { ['--ws-color' as string]: wsColor } : undefined}>
      {/* Primary tab bar: Terminal + extension-contributed tabs */}
      <div className="tab-bar tab-bar--primary">
        <div
          className={`tab-bar__tab${isTerminalActive ? ' tab-bar__tab--active' : ''}`}
          onClick={() => onSelectProjectTab(null)}
        >
          <span className="tab-bar__title">Terminal</span>
        </div>

        {projectTabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-bar__tab${tab.id === activeProjectTabId ? ' tab-bar__tab--active' : ''}`}
            onClick={() => onSelectProjectTab(tab.id)}
          >
            <span className="tab-bar__title">{tab.label}</span>
          </div>
        ))}
      </div>

      {/* Session sub-tab bar: only visible when Terminal is the active primary tab */}
      {isTerminalActive && (
        <div className="tab-bar tab-bar--sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`tab-bar__tab tab-bar__tab--session${session.id === activeSessionId ? ' tab-bar__tab--active' : ''}`}
              onClick={() => handleSessionTabClick(session.id)}
            >
              <span className="tab-bar__title">{session.tabTitle}</span>
              {session.type === 'agent' && (
                <span className="tab-bar__badge tab-bar__badge--agent">agent</span>
              )}
              {session.id !== activeSessionId && (
                <AlertBadge count={getBellCountForSession(session.id)} className="alert-badge--tab" />
              )}
              <button
                className="tab-bar__close"
                onClick={(e) => handleCloseSession(e, session.id)}
                title="Close tab"
              >
                ×
              </button>
            </div>
          ))}
          <button className="tab-bar__new-tab" onClick={() => setNewTabOpen(true)} title="New tab (⌘T)">
            +
          </button>
        </div>
      )}

      {newTabOpen && <NewTabDialog projectId={projectId} onClose={() => setNewTabOpen(false)} />}
    </div>
  )
}
