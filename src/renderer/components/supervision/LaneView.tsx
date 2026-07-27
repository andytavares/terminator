import React from 'react'
import { AlertTriangle, Lock, RefreshCw } from 'lucide-react'
import type { LaneViewModel } from '../../../shared/supervision/view-types.js'
import './supervision.css'

// Concept 06. A single-lane work item renders as one row with none of the
// multi-repository ceremony (FR-089) — the common case must not pay for the
// rare one.

export interface LaneViewProps {
  lanes: readonly LaneViewModel[]
  mergedOrds: readonly number[]
  staleOrds: readonly number[]
  /** Why a merge is blocked, keyed by lane ordinal. */
  blockedReasons: Readonly<Record<number, string>>
  onMerge(ord: number): void
}

export function LaneView({
  lanes,
  mergedOrds,
  staleOrds,
  blockedReasons,
  onMerge,
}: LaneViewProps): JSX.Element {
  const singleLane = lanes.length === 1

  return (
    <div className="sv-panel">
      {!singleLane && (
        <div className="sv-panel__header">
          <span>{lanes.length} repositories</span>
          <span>merge order left to right</span>
        </div>
      )}

      {lanes.map((view) => {
        const merged = mergedOrds.includes(view.lane.ord)
        const stale = staleOrds.includes(view.lane.ord)
        const blockedReason = blockedReasons[view.lane.ord]

        return (
          <div className="sv-row" key={view.lane.ord}>
            {!singleLane && <span className="sv-row__grade">{view.lane.ord}</span>}

            <span className="sv-row__main">
              <div className="sv-queue__title">
                {view.lane.repo}
                <span className="sv-queue__meta"> · {view.lane.branch}</span>
              </div>
              <div className="sv-queue__meta">
                {view.lane.role}
                {view.lane.task_ids.length > 0 && ` · ${view.lane.task_ids.join(', ')}`}
                {merged && ' · merged'}
              </div>

              {view.collisions.length > 0 && (
                // Flagged on every lane that touches it, so each agent is
                // warned before it starts rather than after a conflict (FR-087).
                <div className="sv-warn">
                  <AlertTriangle aria-hidden="true" />
                  Predicted collision: {view.collisions.join(', ')}
                </div>
              )}

              {stale && (
                <div className="sv-warn">
                  <RefreshCw aria-hidden="true" />
                  An upstream lane changed a shared file after this one started — rebase or re-run
                </div>
              )}

              {blockedReason !== undefined && (
                <div className="sv-warn">
                  <Lock aria-hidden="true" />
                  {blockedReason}
                </div>
              )}
            </span>

            {!merged && (
              <button
                className="sv-queue__btn"
                disabled={blockedReason !== undefined}
                onClick={() => onMerge(view.lane.ord)}
              >
                Merge
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
