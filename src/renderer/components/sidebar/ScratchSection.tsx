import React from 'react'
import type { TerminalSession } from '../../../shared/types/index'
import './ScratchSection.css'

interface ScratchSectionProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewScratch: () => void
}

export function ScratchSection({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewScratch,
}: ScratchSectionProps): JSX.Element {
  return (
    <div className="scratch-section">
      <div className="scratch-section__label">Scratch</div>
      {sessions.map((session) => (
        <button
          key={session.id}
          className={`scratch-section__row${activeSessionId === session.id ? ' scratch-section__row--active' : ''}`}
          onClick={() => onSelectSession(session.id)}
        >
          <span className="scratch-section__row-prefix">~</span>
          <span className="scratch-section__row-title">{session.tabTitle}</span>
        </button>
      ))}
      <button className="scratch-section__add" onClick={onNewScratch}>
        <span>+</span>
        <span>New scratch terminal</span>
      </button>
    </div>
  )
}
