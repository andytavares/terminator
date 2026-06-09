import React from 'react'
import { useSessionStore } from '../../stores/session.store'
import { ActivitySpinner } from '../ActivitySpinner'
import { AlertBadge } from '../AlertBadge'
import './ScratchPanel.css'

interface Props {
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
}

export function ScratchPanel({ activeSessionId, onSelectSession }: Props): JSX.Element | null {
  const { getScratchSessions, closeSession, getBellCountForSession, isSessionBusy } =
    useSessionStore()
  const sessions = getScratchSessions()

  if (sessions.length === 0) return null

  function handleClose(e: React.MouseEvent, sessionId: string): void {
    e.stopPropagation()
    void closeSession(sessionId)
  }

  return (
    <div className="scratch-panel">
      <div className="scratch-panel__header">Scratch</div>
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId
        return (
          <div
            key={session.id}
            className={`scratch-panel__row${isActive ? ' scratch-panel__row--active' : ''}`}
            onClick={() => onSelectSession(session.id)}
          >
            <div className="scratch-panel__indicators">
              <AlertBadge count={getBellCountForSession(session.id)} />
              {isSessionBusy(session.id) && <ActivitySpinner />}
            </div>
            <span className="scratch-panel__title" title={session.tabTitle}>
              {session.tabTitle}
            </span>
            <button
              className="scratch-panel__close"
              onClick={(e) => handleClose(e, session.id)}
              title="Close"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
