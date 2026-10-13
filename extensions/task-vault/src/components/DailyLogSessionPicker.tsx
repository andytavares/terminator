import React from 'react'
import { IconButton } from '@terminator/extension-ui'
import { X } from 'lucide-react'
import { SessionOptions, useTerminalSessions } from './terminal-sessions'

/** The session a task is linked to. */
export interface SessionChoice {
  sessionId: string
  projectId: string
}

interface SessionPickerProps {
  onSelect: (session: SessionChoice) => void
  onClose: () => void
}

export function SessionPicker({ onSelect, onClose }: SessionPickerProps): React.JSX.Element {
  const { sessions: activeSessions, labelOf } = useTerminalSessions(true)
  if (activeSessions.length === 0) {
    return (
      <span className="daily-log__link-picker">
        <span className="tv-text-muted-sm">No active terminal sessions.</span>
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </span>
    )
  }
  const choose = (id: string) => {
    const s = activeSessions.find((a) => a.sessionId === id)
    if (s) onSelect({ sessionId: s.sessionId, projectId: s.projectId })
  }
  return (
    <span className="daily-log__link-picker">
      <select onChange={(e) => choose(e.target.value)} defaultValue="">
        <SessionOptions
          sessions={activeSessions}
          labelOf={labelOf}
          placeholder="Select a terminal session…"
        />
      </select>
      <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
    </span>
  )
}
