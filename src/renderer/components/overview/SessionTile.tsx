import React, { memo, useRef, useLayoutEffect } from 'react'
import { Bell, X } from 'lucide-react'
import type { ProcessMetrics } from '../../../shared/types/index'
import type { BoardCard } from '../../sidebar/board-lanes'
import { formatRelativeTime } from '../../sidebar/relative-time'
import { useSessionStore } from '../../stores/session.store'
import './SessionTile.css'

function formatRss(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

interface Props {
  card: BoardCard
  processMetrics: ProcessMetrics | null
  /** Passed rather than read, so a card's age is testable at its boundaries. */
  now: number
  onNavigate: () => void
}

/**
 * One terminal, as the board draws it.
 *
 * The live preview is what makes a card worth more than a row — you can read
 * the question an agent is actually asking without opening it. `mountPreview`
 * moves the single live xterm element in here, so this component must keep the
 * same DOM node across a state change; the board guarantees that by never
 * re-parenting it (see BoardScreen).
 *
 * Every optional fact is omitted rather than drawn empty (FR-013): a terminal
 * with no bells has no bell, not a zero.
 */
function SessionTileInner({ card, processMetrics, now, onNavigate }: Props): JSX.Element {
  const previewRef = useRef<HTMLDivElement>(null)
  const { getTerminalInstance, closeSession } = useSessionStore()

  function handleClose(e: React.MouseEvent): void {
    e.stopPropagation()
    void closeSession(card.sessionId)
  }

  useLayoutEffect(() => {
    const instance = getTerminalInstance(card.sessionId)
    if (!instance || !previewRef.current) return
    const cleanup = instance.mountPreview(previewRef.current)
    return cleanup ?? undefined
  }, [card.sessionId, getTerminalInstance])

  return (
    <div
      className="session-tile"
      style={
        card.workspaceColor === null
          ? undefined
          : { ['--tile-ws-color' as string]: card.workspaceColor }
      }
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onNavigate()
      }}
      aria-label={`Switch to ${card.title} — ${card.sourceLabel}`}
    >
      <div className="session-tile__thumb">
        <div ref={previewRef} className="session-tile__preview" />
        <button
          className="session-tile__close"
          onClick={handleClose}
          aria-label={`Close ${card.title}`}
          tabIndex={-1}
        >
          <X aria-hidden="true" />
        </button>
      </div>

      <div className="session-tile__body">
        <div className="session-tile__title">{card.title}</div>
        <div className="session-tile__source">{card.sourceLabel}</div>
        <div className="session-tile__foot">
          {card.bellCount > 0 && (
            <span className="session-tile__bell">
              <Bell aria-hidden="true" />
              {card.bellCount}
            </span>
          )}
          {processMetrics && (
            <span className="session-tile__metrics">
              {processMetrics.cpuPercent.toFixed(1)}% · {formatRss(processMetrics.rssBytes)}
            </span>
          )}
          <span className="session-tile__age">{formatRelativeTime(card.lastActivityAt, now)}</span>
        </div>
      </div>
    </div>
  )
}

export const SessionTile = memo(SessionTileInner, (prev, next) => {
  return (
    prev.card.sessionId === next.card.sessionId &&
    prev.card.title === next.card.title &&
    prev.card.sourceLabel === next.card.sourceLabel &&
    prev.card.bellCount === next.card.bellCount &&
    prev.card.lastActivityAt === next.card.lastActivityAt &&
    prev.card.workspaceColor === next.card.workspaceColor &&
    prev.now === next.now &&
    prev.processMetrics?.cpuPercent === next.processMetrics?.cpuPercent &&
    prev.processMetrics?.rssBytes === next.processMetrics?.rssBytes
  )
})
