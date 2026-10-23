import React, { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical } from 'lucide-react'
import { useBreakoutStore } from '../../stores/breakout.store'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { branchLabel } from '../../sidebar/branch-display'
import { SCRATCH_PROJECT_ID, type TerminalSession } from '../../../shared/types/index'
import { TabStateIcon } from './TabBar'
import './BreakoutWindowView.css'

interface Place {
  label: string
  color?: string
}

/** The workspace and branch a terminal belongs to, as the header names them. */
function usePlaceOf(projectId: string): Place | null {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWorkspaceId = useWorkspaceStore((s) => s.projectsByWorkspaceId)
  if (projectId === SCRATCH_PROJECT_ID) return { label: 'Scratch' }
  for (const [workspaceId, projects] of projectsByWorkspaceId) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) continue
    const workspace = workspaces.find((w) => w.id === workspaceId)
    const branch = branchLabel(project)
    return { label: workspace ? `${workspace.name} · ${branch}` : branch, color: workspace?.color }
  }
  return null
}

/** Puts the session's terminal in the container for as long as the window shows it. */
function useMountedTerminal(sessionId: string, containerRef: React.RefObject<HTMLDivElement>) {
  useLayoutEffect(() => {
    const container = containerRef.current
    const instance = useSessionStore.getState().getTerminalInstance(sessionId)
    if (!instance || !container) return
    container.ownerDocument.body.style.margin = '0'
    instance.mount(container)
    return () => instance.unmount(container)
  }, [sessionId, containerRef])
}

function BreakoutHeader({ session }: { session: TerminalSession }): JSX.Element {
  const place = usePlaceOf(session.projectId)
  return (
    <div className="breakout-window__header">
      <div role="tablist" className="breakout-window__tabs">
        <div
          role="tab"
          aria-selected="true"
          aria-label={`${session.tabTitle}, in its own window`}
          className="breakout-window__tab"
        >
          <GripVertical className="breakout-window__grip" aria-hidden="true" />
          <TabStateIcon session={session} />
          <span className="breakout-window__title">{session.tabTitle}</span>
        </div>
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
  useMountedTerminal(sessionId, containerRef)
  if (!session) return null
  return (
    <div className="breakout-window">
      <BreakoutHeader session={session} />
      <div ref={containerRef} className="breakout-window__terminal" />
    </div>
  )
}

/** Draws every terminal that lives in its own window into that window. */
export function BreakoutWindows(): JSX.Element {
  const windows = useBreakoutStore((s) => s.windows)
  return (
    <>
      {[...windows].map(([sessionId, win]) =>
        createPortal(<BreakoutWindowView sessionId={sessionId} />, win.document.body, sessionId)
      )}
    </>
  )
}
