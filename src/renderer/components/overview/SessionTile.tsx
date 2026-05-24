import React, { memo, useRef, useLayoutEffect } from 'react'
import type {
  TerminalSession,
  Workspace,
  Project,
  ProcessMetrics,
} from '../../../../shared/types/index'
import type { TerminalInstance } from '../terminal/TerminalSession'
import { ActivitySpinner } from '../ActivitySpinner'
import { useSessionStore } from '../../stores/session.store'
import './SessionTile.css'

function formatRss(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

interface Props {
  session: TerminalSession
  workspace: Workspace
  project: Project
  processMetrics: ProcessMetrics | null
  tileIndex: number
  onNavigate: () => void
}

function SessionTileInner({
  session,
  workspace,
  project,
  processMetrics,
  onNavigate,
}: Props): JSX.Element {
  const previewRef = useRef<HTMLDivElement>(null)
  const { getTerminalInstance, isSessionBusy } = useSessionStore()
  const isBusy = isSessionBusy(session.id)

  useLayoutEffect(() => {
    const instance = getTerminalInstance(session.id) as TerminalInstance | undefined
    if (!instance || !previewRef.current) return
    const cleanup = instance.mountPreview(previewRef.current)
    return cleanup ?? undefined
  }, [session.id, getTerminalInstance])

  return (
    <div
      className="session-tile"
      style={{ ['--tile-ws-color' as string]: workspace.color }}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onNavigate()
      }}
      aria-label={`Switch to ${project.name} — ${session.tabTitle}`}
    >
      <div className="session-tile__thumb">
        <div ref={previewRef} className="session-tile__preview" />
        {isBusy && (
          <div className="session-tile__busy">
            <ActivitySpinner />
          </div>
        )}
      </div>

      <div className="session-tile__footer">
        <div className="session-tile__header">
          <span className="session-tile__workspace">{workspace.name}</span>
          <span className="session-tile__project">{project.name}</span>
          <span className="session-tile__tab">{session.tabTitle}</span>
        </div>

        {processMetrics && (
          <div className="session-tile__metrics">
            <span>CPU {processMetrics.cpuPercent.toFixed(1)}%</span>
            <span>{formatRss(processMetrics.rssBytes)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export const SessionTile = memo(SessionTileInner, (prev, next) => {
  return (
    prev.session.id === next.session.id &&
    prev.session.tabTitle === next.session.tabTitle &&
    prev.processMetrics?.cpuPercent === next.processMetrics?.cpuPercent &&
    prev.processMetrics?.rssBytes === next.processMetrics?.rssBytes
  )
})
