import React, { useRef } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical } from 'lucide-react'
import { useBreakoutStore } from '../../stores/breakout.store'
import { useSessionStore } from '../../stores/session.store'
import type { TerminalSession } from '../../../shared/types/index'
import { TabStateIcon } from './TabBar'
import { beginSessionDrag, endSessionDrag } from '../../terminal/session-drag'
import { useMountedTerminal } from './use-mounted-terminal'
import { usePlaceOf } from './place-of'
import { BreakoutDropZone } from './BreakoutDropZone'
import './BreakoutWindowView.css'

function BreakoutTab({ session }: { session: TerminalSession }): JSX.Element {
  return (
    <div
      role="tab"
      aria-selected="true"
      aria-label={`${session.tabTitle}, in its own window`}
      className="breakout-window__tab"
      draggable
      onDragStart={(e) => beginSessionDrag(e, session.id)}
      onDragEnd={endSessionDrag}
    >
      <GripVertical className="breakout-window__grip" aria-hidden="true" />
      <TabStateIcon session={session} />
      <span className="breakout-window__title">{session.tabTitle}</span>
    </div>
  )
}

function BreakoutHeader({ session }: { session: TerminalSession }): JSX.Element {
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

function BreakoutWindowView({ sessionId }: { sessionId: string }): JSX.Element | null {
  const session = useSessionStore((s) => s.sessions.get(sessionId))
  const containerRef = useRef<HTMLDivElement>(null)
  useMountedTerminal(containerRef, sessionId)
  if (!session) return null
  return (
    <div className="breakout-window">
      <BreakoutHeader session={session} />
      <div ref={containerRef} className="breakout-window__terminal" />
    </div>
  )
}

/** Draws every terminal that lives in its own window into that window. */
/** Each terminal's own window, and the drop on the main window that brings one back. */
export function BreakoutWindows(): JSX.Element {
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
