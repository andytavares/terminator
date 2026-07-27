import React from 'react'
import { StateIndicator, formatElapsed } from './StateIndicator.js'
import type { AttentionItem } from '../../../shared/supervision/rank-attention.js'
import './supervision.css'

// Concept 01. One ranked list of everything needing the operator, ordered by
// attention need and never grouped by repository (FR-022). Permission requests
// are answerable inline, without opening the session (FR-023).

export interface AttentionQueueProps {
  items: readonly AttentionItem[]
  /** Null until the first load completes — distinct from "nothing needs you". */
  loaded: boolean
  workingCount: number
  onApprove(sessionId: string, requestId: string): void
  onDeny(sessionId: string, requestId: string): void
  onOpen(sessionId: string): void
}

const REASON_TITLES: Record<AttentionItem['reason'], string> = {
  needs_input: 'Waiting on you',
  stalled: 'Stopped making progress',
  failed: 'Failed',
  ready: 'Ready to review',
  unknown: 'State unknown',
}

export function AttentionQueue({
  items,
  loaded,
  workingCount,
  onApprove,
  onDeny,
  onOpen,
}: AttentionQueueProps): JSX.Element {
  if (!loaded) {
    // Never claim all-clear before we have actually looked.
    return <div className="sv-allclear">Checking sessions…</div>
  }

  if (items.length === 0) {
    // FR-024: assert that everything is fine. Silence is indistinguishable from
    // a console that has crashed, which is the complacency failure this avoids.
    return (
      <div className="sv-allclear">
        {workingCount === 0
          ? 'Nothing needs you, and nothing is running.'
          : `Nothing needs you. ${workingCount} ${
              workingCount === 1 ? 'session is' : 'sessions are'
            } working.`}
      </div>
    )
  }

  return (
    <div className="sv-queue" role="list" aria-label="Needs your attention">
      {items.map((item) => (
        <div className="sv-queue__item" role="listitem" key={item.sessionId}>
          <StateIndicator state={item.reason} showLabel={false} sinceMs={item.waitingMs} />

          <button className="sv-queue__main" onClick={() => onOpen(item.sessionId)}>
            <div className="sv-queue__title">
              {item.pendingPermission?.summary ?? REASON_TITLES[item.reason]}
            </div>
            <div className="sv-queue__meta">
              {item.repoPath.split('/').pop()} · {REASON_TITLES[item.reason]} ·{' '}
              {formatElapsed(item.waitingMs)}
              {item.pendingPermission?.targetHost !== undefined && (
                <> · host {item.pendingPermission.targetHost}</>
              )}
            </div>
          </button>

          {item.pendingPermission !== null && (
            <div className="sv-queue__actions">
              <button
                className="sv-queue__btn"
                onClick={() => onApprove(item.sessionId, item.pendingPermission!.requestId)}
              >
                Allow
              </button>
              <button
                className="sv-queue__btn"
                onClick={() => onDeny(item.sessionId, item.pendingPermission!.requestId)}
              >
                Deny
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
