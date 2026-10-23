import React, { useEffect, useState } from 'react'
import { AppWindow } from 'lucide-react'
import { isBrokenOut } from '../../stores/breakout.store'
import { useSessionStore } from '../../stores/session.store'
import { dockBack } from '../../terminal/breakout'
import { draggedSession } from '../../terminal/session-drag'
import { usePlaceOf } from './BreakoutWindowView'
import './BreakoutDropZone.css'

/** The terminal being dragged, when it is one that lives in its own window. */
function draggedBreakoutSession(): string | null {
  const sessionId = draggedSession()
  return sessionId !== null && isBrokenOut(sessionId) ? sessionId : null
}

type Listeners = [string, (e: Event) => void][]

function dragListeners(setSessionId: (sessionId: string | null) => void): Listeners {
  const hide = (): void => setSessionId(null)
  return [
    ['dragenter', () => setSessionId(draggedBreakoutSession())],
    [
      'dragover',
      (e) => {
        if (draggedBreakoutSession() !== null) e.preventDefault()
      },
    ],
    [
      'dragleave',
      (e) => {
        if (!(e as DragEvent).relatedTarget) hide()
      },
    ],
    [
      'drop',
      (e) => {
        const dropped = draggedBreakoutSession()
        if (dropped === null) return
        e.preventDefault()
        dockBack(dropped)
        hide()
      },
    ],
    ['dragend', hide],
  ]
}

/** The breakout terminal being dragged over this window, from its first dragenter until it
 * leaves or drops. */
function useDraggedBreakoutSession(): string | null {
  const [sessionId, setSessionId] = useState<string | null>(null)
  useEffect(() => {
    const listeners = dragListeners(setSessionId)
    listeners.forEach(([type, listener]) => document.addEventListener(type, listener))
    return () =>
      listeners.forEach(([type, listener]) => document.removeEventListener(type, listener))
  }, [])
  return sessionId
}

function ReturnPrompt({ sessionId }: { sessionId: string }): JSX.Element | null {
  const session = useSessionStore((s) => s.sessions.get(sessionId))
  const place = usePlaceOf(session?.projectId ?? '')
  if (!session) return null
  return (
    <div
      role="region"
      aria-label={`Return ${session.tabTitle} to its tabs`}
      className="breakout-drop-zone"
    >
      <div className="breakout-drop-zone__card">
        <AppWindow aria-hidden="true" className="breakout-drop-zone__icon" />
        <span className="breakout-drop-zone__title">
          Drop to return <b>{session.tabTitle}</b>
        </span>
        {place && <span className="breakout-drop-zone__place">to {place.label}</span>}
      </div>
    </div>
  )
}

/** Over the whole main window while a terminal from its own window is dragged in: dropping docks it. */
export function BreakoutDropZone(): JSX.Element | null {
  const sessionId = useDraggedBreakoutSession()
  return sessionId === null ? null : <ReturnPrompt sessionId={sessionId} />
}
