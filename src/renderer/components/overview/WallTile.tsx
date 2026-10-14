import React from 'react'
import { SquareArrowOutUpRight } from 'lucide-react'
import { StateChip } from '../session/StateChip'
import { LivePreview } from '../session/LivePreview'
import { WorkItemCell } from '../session/WorkItemCell'
import { ResumeButton } from '../session/ResumeButton'
import { CloseSessionButton } from '../session/CloseSessionButton'
import { useIssue } from '../session/useSessionFacts'
import { formatRelativeTime } from '../../sidebar/relative-time'
import type { SessionActions, SessionFacts } from '../../sidebar/session-facts'
import type { WallPlacement } from '../../sidebar/wall-order'
import type { ProcessMetrics } from '../../../shared/types/index'
import './WallTile.css'

interface Props extends SessionActions {
  facts: SessionFacts
  placement: WallPlacement
  metrics: ProcessMetrics | null
  now: number
  /** Buttons answering a waiting prompt, drawn in the footer. */
  answers?: React.ReactNode
}

function formatRss(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function locationOf(facts: SessionFacts): string {
  const parts = [facts.workspaceName, facts.projectName, facts.branch].filter(
    (p): p is string => p !== null
  )
  return parts.length === 0 ? 'No branch' : parts.join(' / ')
}

/**
 * One live terminal on the wall.
 *
 * Its position is `order` and `grid-column` only. The wall never reorders or
 * re-parents a tile, because the live preview inside it is the session's one
 * xterm element and would be torn out.
 */
export function WallTile(props: Props): JSX.Element {
  const { facts, placement, onOpen } = props
  const location = locationOf(facts)
  return (
    <article
      className={`wall-tile${facts.state === 'awaiting-input' ? ' wall-tile--needs' : ''}`}
      data-band={placement.band}
      aria-label={`${location}, ${facts.name}`}
      tabIndex={0}
      style={{
        order: placement.order,
        gridColumn: `span ${placement.span}`,
        ...(facts.workspaceColor ? { ['--rail' as string]: facts.workspaceColor } : {}),
      }}
      onClick={() => onOpen(facts.sessionId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(facts.sessionId)
      }}
    >
      <TileCap {...props} location={location} />
      <LivePreview sessionId={facts.sessionId} className="wall-tile__preview" />
      <TileFoot {...props} />
    </article>
  )
}

/** State, where the session lives, its name and age, then Open and Close. */
function TileCap({
  facts,
  now,
  onOpen,
  onCloseSession,
  onForgetSession,
  location,
}: Props & { location: string }) {
  return (
    <div className="wall-tile__cap">
      <StateChip state={facts.state} />
      <span className="wall-tile__where">{location}</span>
      <span className="wall-tile__name">{facts.name}</span>
      <span className="wall-tile__age">{formatRelativeTime(facts.lastActivityAt, now)}</span>
      <OpenButton name={facts.name} onOpen={() => onOpen(facts.sessionId)} />
      {onCloseSession && (
        <CloseSessionButton facts={facts} onClose={onCloseSession} onForget={onForgetSession} />
      )}
    </div>
  )
}

function OpenButton({ name, onOpen }: { name: string; onOpen: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="wall-tile__open"
      aria-label={`Open ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      <SquareArrowOutUpRight aria-hidden="true" />
    </button>
  )
}

/** What the session is for, Resume, any answers, and its process load; clicks stay here. */
function TileFoot({ facts, metrics, onSaveDescription, onLink, onResume, answers }: Props) {
  const issue = useIssue(facts.workItem?.ref)
  return (
    <div className="wall-tile__foot" onClick={(e) => e.stopPropagation()}>
      <WorkItemCell
        workItem={facts.workItem}
        issue={issue}
        description={facts.description}
        onSaveDescription={(text) => onSaveDescription(facts, text)}
        onLink={onLink ? () => onLink(facts) : undefined}
      />
      {onResume && <ResumeButton facts={facts} onResume={onResume} />}
      {answers}
      {metrics && (
        <span className="wall-tile__metrics">
          {metrics.cpuPercent.toFixed(1)}% {formatRss(metrics.rssBytes)}
        </span>
      )}
    </div>
  )
}
