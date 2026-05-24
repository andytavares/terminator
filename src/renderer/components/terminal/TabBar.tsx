import React, { useState } from 'react'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { AlertBadge } from '../AlertBadge'
import { ActivitySpinner } from '../ActivitySpinner'
import type { ProjectTabRegistration } from '../../extensions/registry'
import './TabBar.css'

interface Props {
  projectId: string
  activeProjectTabId: string | null
  projectTabs: ProjectTabRegistration[]
  onSelectProjectTab: (tabId: string | null) => void
  onNewTab: () => void
}

export function TabBar({
  projectId,
  activeProjectTabId,
  projectTabs,
  onSelectProjectTab,
  onNewTab,
}: Props): JSX.Element {
  const {
    getSessionsForProject,
    closeSession,
    setActiveSessionForProject,
    getActiveSessionForProject,
    getBellCountForSession,
    isSessionBusy,
    renameSession,
  } = useSessionStore()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
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

  function startRename(e: React.MouseEvent, sessionId: string, currentTitle: string): void {
    e.stopPropagation()
    setRenamingId(sessionId)
    setRenameValue(currentTitle)
  }

  function commitRename(sessionId: string): void {
    const trimmed = renameValue.trim()
    if (trimmed) renameSession(sessionId, trimmed)
    setRenamingId(null)
  }

  function cancelRename(): void {
    setRenamingId(null)
  }

  return (
    <div
      className="tab-bar-stack"
      style={wsColor ? { ['--ws-color' as string]: wsColor } : undefined}
    >
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
              {renamingId === session.id ? (
                <input
                  className="tab-bar__rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(session.id)
                    if (e.key === 'Escape') cancelRename()
                    e.stopPropagation()
                  }}
                  onBlur={() => commitRename(session.id)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span
                  className="tab-bar__title"
                  onDoubleClick={(e) => startRename(e, session.id, session.tabTitle)}
                  title="Double-click to rename"
                >
                  {session.tabTitle}
                </span>
              )}
              {renamingId !== session.id && isSessionBusy(session.id) && <ActivitySpinner />}
              {session.id !== activeSessionId && renamingId !== session.id && (
                <AlertBadge
                  count={getBellCountForSession(session.id)}
                  className="alert-badge--tab"
                />
              )}
              {renamingId !== session.id && (
                <button
                  className="tab-bar__close"
                  onClick={(e) => handleCloseSession(e, session.id)}
                  title="Close tab"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button className="tab-bar__new-tab" onClick={onNewTab} title="New tab (⌘T)">
            +
          </button>
        </div>
      )}
    </div>
  )
}
