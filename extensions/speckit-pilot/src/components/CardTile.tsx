import React from 'react'
import { MessageSquare, ExternalLink } from 'lucide-react'
import type { CardSummary } from '../types/speckit.types.js'
import { completedSummary, nextStepLabel, phaseProgress } from '../state/phase-progress.js'
import { firstProseLine } from '../state/plain-text.js'
import { displayTitle } from '../state/card-title.js'

interface CardTileProps {
  card: CardSummary
  commentCount?: number
  onOpen: (featureDir: string) => void
}

/**
 * One card on the board.
 *
 * It used to carry ten identical circles numbered 1 to 10, a chip reading the
 * card's type — which read the same on every card — a status chip repeating the
 * name of the column it was sitting in, and the brief's raw markdown. None of
 * that answered the only question you ask a board card: where has this got to?
 *
 * Now it carries the title, one line of plain prose, how far it is as a bar, and
 * the name of what happens next. The column already says the status; the origin
 * and the type stay, because they do vary between cards.
 */
export function CardTile({ card, commentCount, onOpen }: CardTileProps) {
  const originLabel = card.source === 'native' ? 'native' : (card.sourceKey ?? card.source)
  const progress = phaseProgress(card)
  const summary = firstProseLine(card.scopeLine)

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
      <div className="sk-card-tile__title">{displayTitle(card.title, card.featureDir)}</div>
      {summary && <div className="sk-card-tile__scope">{summary}</div>}

      <div className="sk-card-progress" title={completedSummary(card)}>
        <div
          className="sk-card-progress__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-label={completedSummary(card)}
        >
          <span
            className="sk-card-progress__fill"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
        <div className="sk-card-progress__legend">
          <span className="sk-card-progress__next">{nextStepLabel(card)}</span>
          <span className="sk-card-progress__count">
            {progress.done} of {progress.total}
          </span>
        </div>
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
            {originLabel} <ExternalLink />
          </a>
        ) : (
          <span className="sk-card-origin sk-card-origin--native">{originLabel}</span>
        )}
        <span className="sk-card-tile__metaright">
          <span className={`sk-card-badge sk-card-badge--${card.type}`}>{card.type}</span>
          {commentCount ? (
            <span className="sk-card-tile__comments" aria-label={`${commentCount} comments`}>
              <MessageSquare /> {commentCount}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  )
}
