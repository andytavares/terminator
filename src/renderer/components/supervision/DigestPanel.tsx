import React from 'react'
import { Inbox } from 'lucide-react'
import type { Digest } from '../../../shared/supervision/view-types.js'
import './supervision.css'

// FR-028. Routine progress is deferred to a digest rather than interrupting —
// which is only a discipline if the digest is somewhere you can actually read
// it. Batching progress and then never showing it is the same as dropping it.

export interface DigestPanelProps {
  digest: Digest | null
  windowMinutes: number
  onRefresh(): void
}

function formatWindow(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export function DigestPanel({ digest, windowMinutes, onRefresh }: DigestPanelProps): JSX.Element {
  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>
          <Inbox aria-hidden="true" /> Progress digest · last {formatWindow(windowMinutes)}
        </span>
        <button className="sv-queue__btn" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {/* Asserted, never implied by silence: an empty digest and a console that
          stopped reporting look identical otherwise (FR-024). */}
      {(digest?.entryCount ?? 0) === 0 || digest === null ? (
        <div className="sv-allclear">No routine progress in this window.</div>
      ) : (
        <>
          <div className="sv-row">
            <span className="sv-queue__meta">
              {digest.entryCount} {digest.entryCount === 1 ? 'update' : 'updates'} across{' '}
              {digest.sessionCount} {digest.sessionCount === 1 ? 'session' : 'sessions'}
            </span>
          </div>
          {digest.bySession.map((group) => (
            <div className="sv-row" key={group.sessionId}>
              <span className="sv-row__main">
                <div className="sv-queue__title">{group.sessionId}</div>
                {group.entries.map((entry) => (
                  <div className="sv-queue__meta" key={entry.id}>
                    {entry.summary}
                  </div>
                ))}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
