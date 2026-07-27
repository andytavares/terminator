import React from 'react'
import { StateIndicator, formatElapsed } from './StateIndicator.js'
import type { AttentionItem } from '../../../shared/supervision/rank-attention.js'
import { allClearMessage } from '../../../shared/supervision/all-clear.js'
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

  const allClear = allClearMessage(items.length, workingCount)
  if (allClear !== null) {
    return <div className="sv-allclear">{allClear}</div>
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
            {/* The ask in full. You cannot decide what you cannot read, and
                a summary of an unfamiliar tool is its name, not its request
                (FR-007). */}
            {item.pendingPermission?.detail != null &&
              item.pendingPermission.detail.trim() !== '' && (
                <pre className="sv-queue__detail">{item.pendingPermission.detail}</pre>
              )}
            {/* The reason, on the queue itself: "failed" with the output hidden
                behind a click is exactly the trip this saves (FR-034). */}
            {item.failure !== null && (
              <div className="sv-row__trigger">
                {item.failure.step === 'setup' ? 'setup' : 'agent'}
                {item.failure.exitCode !== null && ` exited ${item.failure.exitCode}`}
                {item.failure.output.trim() !== '' && ` — ${item.failure.output.trim()}`}
              </div>
            )}
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
