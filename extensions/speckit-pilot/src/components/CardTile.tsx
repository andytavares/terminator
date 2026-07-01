import React from 'react'
import { MessageSquare, ExternalLink } from 'lucide-react'
import type { CardRunStatus, CardSummary, PhaseId, PhaseState } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'
import { PhaseRail } from './PhaseRail.js'

const RUN_STATUS_LABEL: Record<CardRunStatus, string> = {
  none: 'Backlog',
  waiting: 'Waiting',
  running: 'Running',
  awaiting_review: 'Needs review',
  failed: 'Failed',
  completed: 'Done',
}

/**
 * Approximate phase states from a card summary so the compact PhaseRail can render
 * without the full per-phase detail (the board only carries a done/total summary).
 */
function approxPhases(card: CardSummary): Record<PhaseId, PhaseState> {
  return Object.fromEntries(
    PHASE_ORDER.map((id, idx) => {
      let status: PhaseState['status'] = 'locked'
      if (idx < card.phaseSummary.done) status = 'approved'
      else if (idx === card.phaseSummary.done && card.runStatus === 'running') status = 'running'
      else if (idx === card.phaseSummary.done && card.phaseSummary.awaitingReview)
        status = 'awaiting_review'
      return [id, { id, status } as PhaseState]
    })
  ) as Record<PhaseId, PhaseState>
}

interface CardTileProps {
  card: CardSummary
  commentCount?: number
  onOpen: (featureDir: string) => void
}

export function CardTile({ card, commentCount, onOpen }: CardTileProps) {
  const originLabel = card.source === 'native' ? 'native' : (card.sourceKey ?? card.source)
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`card-tile-${card.featureDir}`}
      className={`sk-card-tile sk-card-tile--${card.runStatus}`}
      onClick={() => onOpen(card.featureDir)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(card.featureDir)
        }
      }}
    >
      <div className="sk-card-tile__head">
        <span className={`sk-card-badge sk-card-badge--${card.type}`}>{card.type}</span>
        <span className={`sk-card-chip sk-card-chip--${card.runStatus}`}>
          {RUN_STATUS_LABEL[card.runStatus]}
        </span>
      </div>
      <div className="sk-card-tile__title">{card.title}</div>
      {card.scopeLine && <div className="sk-card-tile__scope">{card.scopeLine}</div>}
      <div className="sk-card-tile__rail">
        <PhaseRail phases={approxPhases(card)} />
      </div>
      <div className="sk-card-tile__meta">
        {card.source !== 'native' && card.sourceUrl ? (
          <a
            className={`sk-card-origin sk-card-origin--${card.source}`}
            href={card.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={`Open in ${card.source}`}
            onClick={(e) => e.stopPropagation()}
          >
            {originLabel} <ExternalLink size={10} />
          </a>
        ) : (
          <span className="sk-card-origin sk-card-origin--native">{originLabel}</span>
        )}
        <span className="sk-card-tile__metaright">
          {card.phaseSummary.done}/{card.phaseSummary.total}
          {commentCount ? (
            <span className="sk-card-tile__comments" aria-label={`${commentCount} comments`}>
              <MessageSquare size={12} /> {commentCount}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  )
}
