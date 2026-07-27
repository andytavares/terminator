import React from 'react'
import { formatElapsed } from './StateIndicator.js'
import type { FeedEntry } from '../../../shared/supervision/view-types.js'
import type { RuntimeState } from '../../../shared/types/supervision.js'
import './supervision.css'

// FR-027, built once and reused wherever a session is opened. The PRD calls
// this the one novel part of the Command Deck; making it a component rather
// than a screen is what lets every surface show it.

export interface SinceYouLastLookedProps {
  lastViewedAt: number | null
  now: number
  entries: readonly FeedEntry[]
  stateChanges: ReadonlyArray<{ to: RuntimeState; at: number }>
  diffDelta: { files: number; added: number; removed: number } | null
}

export function SinceYouLastLooked({
  lastViewedAt,
  now,
  entries,
  stateChanges,
  diffDelta,
}: SinceYouLastLookedProps): JSX.Element | null {
  if (lastViewedAt === null) {
    // Never looked before, so there is no "since" to report. Saying "nothing
    // changed" would be wrong; saying nothing at all is correct.
    return null
  }

  const newEntries = entries.filter((entry) => entry.at > lastViewedAt)
  const newStates = stateChanges.filter((change) => change.at > lastViewedAt)
  const changedFiles = diffDelta?.files ?? 0

  if (newEntries.length === 0 && newStates.length === 0 && changedFiles === 0) {
    return (
      <div className="sv-panel__header">
        Nothing has changed in the {formatElapsed(now - lastViewedAt)} since you last looked.
      </div>
    )
  }

  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>Since you last looked · {formatElapsed(now - lastViewedAt)} ago</span>
      </div>

      {newStates.length > 0 && (
        <div className="sv-row">
          <span className="sv-row__main">
            <div className="sv-queue__meta">State</div>
            <div className="sv-queue__title">
              {newStates.map((change) => change.to).join(' → ')}
            </div>
          </span>
        </div>
      )}

      {changedFiles > 0 && diffDelta !== null && (
        <div className="sv-row">
          <span className="sv-row__main">
            <div className="sv-queue__meta">Changes</div>
            <div className="sv-queue__title">
              {diffDelta.files} files · +{diffDelta.added} −{diffDelta.removed}
            </div>
          </span>
        </div>
      )}

      {newEntries.map((entry) => (
        <div className="sv-feed__entry" key={entry.id}>
          <div className={`sv-feed__author sv-feed__author--${entry.author}`}>
            {entry.author === 'console' ? 'Terminator' : 'agent'}
          </div>
          <div className="sv-feed__summary">{entry.summary}</div>
        </div>
      ))}
    </div>
  )
}
