import React, { useEffect, useRef } from 'react'
import { useSessionStore } from '../../stores/session.store'
import type { TerminalInstance } from './TerminalSession'
import './TerminalPane.css'

interface Props {
  projectId: string
}

export function TerminalPane({ projectId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevSessionIdRef = useRef<string | null>(null)
  const { getSessionsForProject, getActiveSessionForProject, getTerminalInstance, clearBellCount } =
    useSessionStore()

  const activeSessionId = getActiveSessionForProject(projectId)
  const sessions = getSessionsForProject(projectId)

  useEffect(() => {
    if (activeSessionId) clearBellCount(activeSessionId)
  }, [activeSessionId, clearBellCount])

  useEffect(() => {
    const prevId = prevSessionIdRef.current
    const nextId = activeSessionId
    if (prevId === nextId) return

    if (prevId) {
      const prev = getTerminalInstance(prevId) as TerminalInstance | undefined
      prev?.unmount()
    }

    if (nextId && containerRef.current) {
      const next = getTerminalInstance(nextId) as TerminalInstance | undefined
      next?.mount(containerRef.current)
    }

    prevSessionIdRef.current = nextId
  }, [activeSessionId, getTerminalInstance])

  if (sessions.length === 0) {
    return (
      <div className="terminal-pane terminal-pane--empty">
        <span>Open a terminal tab to get started</span>
      </div>
    )
  }

  function handleClick(): void {
    if (activeSessionId) {
      const instance = getTerminalInstance(activeSessionId) as TerminalInstance | undefined
      instance?.terminal.focus()
    }
  }

  return (
    <div className="terminal-pane" onClick={handleClick}>
      <div ref={containerRef} className="terminal-pane__container" />
    </div>
  )
}
