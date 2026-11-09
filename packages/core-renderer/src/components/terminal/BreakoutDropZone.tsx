import React from 'react'
import { AppWindow } from 'lucide-react'
import { useBreakoutStore } from '../../stores/breakout.store'
import { useSessionStore } from '../../stores/session.store'
import { useTabDragStore } from '../../terminal/tab-drag'
import { usePlaceOf } from './place-of'
import './BreakoutDropZone.css'

/** The terminal from its own window whose tab is being dragged over the main window. */
function useBreakoutTabOverMainWindow(): string | null {
  const { sessionId, overMainWindow } = useTabDragStore()
  const brokenOut = useBreakoutStore((s) => sessionId !== null && s.windows.has(sessionId))
  return brokenOut && overMainWindow ? sessionId : null
}

function ReturnPrompt({ sessionId }: { sessionId: string }): React.JSX.Element | null {
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

/** Over the whole main window while a terminal's tab is dragged in from its own window; letting
 * go docks it (BreakoutWindowView's drop does that). */
export function BreakoutDropZone(): React.JSX.Element | null {
  const sessionId = useBreakoutTabOverMainWindow()
  return sessionId === null ? null : <ReturnPrompt sessionId={sessionId} />
}
