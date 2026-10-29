import React, { useRef } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical } from 'lucide-react'
import { useBreakoutStore } from '../../stores/breakout.store'
import { useSessionStore } from '../../stores/session.store'
import type { TerminalSession } from '../../../shared/types/index'
import { TabStateIcon } from './TabBar'
import { beginTabDrag, windowContains, type ScreenPoint } from '../../terminal/tab-drag'
import { dockBack } from '../../terminal/breakout'
import { useMountedTerminal } from './use-mounted-terminal'
import { usePlaceOf } from './place-of'
import { BreakoutDropZone } from './BreakoutDropZone'
import { AgentView } from '../agent/AgentView'
import './BreakoutWindowView.css'

/** Let go over the main window, the terminal goes back among its tabs. `window` is the main
 * window: this code runs in its renderer even while drawing into the terminal's own window. */
function dockIfOverMainWindow(sessionId: string) {
  return (point: ScreenPoint): void => {
    if (windowContains(window, point)) dockBack(sessionId)
  }
}

function BreakoutTab({ session }: { session: TerminalSession }): React.JSX.Element {
  return (
    <div
      role="tab"
      aria-selected="true"
      aria-label={`${session.tabTitle}, in its own window`}
      className="breakout-window__tab"
      onPointerDown={(e) => beginTabDrag(e, session.id, dockIfOverMainWindow(session.id))}
    >
      <GripVertical className="breakout-window__grip" aria-hidden="true" />
      <TabStateIcon session={session} />
      <span className="breakout-window__title">{session.tabTitle}</span>
    </div>
  )
}

function BreakoutHeader({ session }: { session: TerminalSession }): React.JSX.Element {
  const place = usePlaceOf(session.projectId)
  return (
    <div className="breakout-window__header">
      <div role="tablist" className="breakout-window__tabs">
        <BreakoutTab session={session} />
      </div>
      {place && (
        <span
          className="breakout-window__place"
          style={place.color ? { ['--ws-color' as string]: place.color } : undefined}
        >
          {place.color && <span className="breakout-window__swatch" aria-hidden="true" />}
          {place.label}
        </span>
      )}
    </div>
  )
}

function BreakoutWindowView({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const session = useSessionStore((s) => s.sessions.get(sessionId))
  const containerRef = useRef<HTMLDivElement>(null)
  useMountedTerminal(containerRef, sessionId)
  if (!session) return null
  return (
    <div className="breakout-window">
      <BreakoutHeader session={session} />
      {session.surface === 'agent' ? (
        <AgentView sessionId={sessionId} />
      ) : (
        <div ref={containerRef} className="breakout-window__terminal" />
      )}
    </div>
  )
}

/** Each terminal's own window, and the drop on the main window that brings one back. */
export function BreakoutWindows(): React.JSX.Element {
  const windows = useBreakoutStore((s) => s.windows)
  return (
    <>
      {[...windows].map(([sessionId, win]) =>
        createPortal(<BreakoutWindowView sessionId={sessionId} />, win.document.body, sessionId)
      )}
      <BreakoutDropZone />
    </>
  )
}
