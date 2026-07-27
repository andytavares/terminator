import React, { useState } from 'react'
import { Square, Trash2, ExternalLink } from 'lucide-react'
import { StateIndicator, formatElapsed } from './StateIndicator.js'
import type { SupervisedSession } from '../../../shared/types/supervision.js'
import './supervision.css'

// Every session, whether or not it wants anything.
//
// The attention queue answers "what needs me"; nothing answered "what is
// running". A console for supervising agents that cannot show you the agents,
// or stop one, is not supervising them — and the count in the status bar is
// not a list.

export interface SessionListProps {
  sessions: readonly SupervisedSession[]
  now: number
  /** Ends the run, keeping the working copy and its diff. */
  onStop(sessionId: string, reason?: string): void
  /** Ends it and removes the working copy. */
  onDiscard(sessionId: string): void
  onOpen(sessionId: string): void
}

/** States in which an agent is still consuming time and money. */
const RUNNING: ReadonlySet<string> = new Set(['starting', 'working', 'needs_input', 'stalled'])

/** Running first, then whatever changed most recently. */
function order(a: SupervisedSession, b: SupervisedSession): number {
  const running = Number(RUNNING.has(b.runtimeState)) - Number(RUNNING.has(a.runtimeState))
  return running !== 0 ? running : b.stateSince - a.stateSince
}

function cost(session: SupervisedSession): string {
  const parts = [`${session.turns} ${session.turns === 1 ? 'turn' : 'turns'}`]
  if (session.costUsd > 0) parts.push(`$${session.costUsd.toFixed(2)}`)
  if (session.contextPct !== null) parts.push(`${session.contextPct}% context`)
  return parts.join(' · ')
}

function diff(session: SupervisedSession): string | null {
  const { files, added, removed } = session.diffSummary
  return files === 0 ? null : `${files} ${files === 1 ? 'file' : 'files'} +${added} −${removed}`
}

/**
 * Stopping, with a reason.
 *
 * The reason is optional but offered every time: coming back to a half-finished
 * diff a day later, "stopped by the operator" tells you nothing and "wrong
 * branch" tells you everything. It reaches the agent's own record too, not just
 * ours.
 */
function StopControl({ onStop }: { onStop(reason?: string): void }): JSX.Element {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')

  if (!asking) {
    return (
      <button className="sv-queue__btn" onClick={() => setAsking(true)}>
        <Square aria-hidden="true" /> Stop
      </button>
    )
  }

  const stop = (): void => {
    onStop(reason.trim() === '' ? undefined : reason.trim())
    setReason('')
    setAsking(false)
  }

  return (
    <span className="sv-stop">
      <input
        aria-label="Why are you stopping it?"
        placeholder="why? (optional)"
        value={reason}
        autoFocus
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') stop()
          if (event.key === 'Escape') setAsking(false)
        }}
      />
      <button className="sv-queue__btn sv-btn--primary" onClick={stop}>
        <Square aria-hidden="true" /> Stop
      </button>
    </span>
  )
}

export function SessionList({
  sessions,
  now,
  onStop,
  onDiscard,
  onOpen,
}: SessionListProps): JSX.Element {
  if (sessions.length === 0) {
    return <div className="sv-allclear">No sessions. Start one from Needs you.</div>
  }

  const running = sessions.filter((session) => RUNNING.has(session.runtimeState)).length

  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>
          {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
        </span>
        <span>
          {running} running
          {/* The number is the thing you glance at; the list is underneath it. */}
        </span>
      </div>

      {[...sessions].sort(order).map((session) => (
        <div className="sv-row" key={session.id}>
          <StateIndicator
            state={session.runtimeState}
            showLabel={false}
            sinceMs={Math.max(0, now - session.stateSince)}
          />

          <span className="sv-row__main">
            <div className="sv-queue__title">{session.branch}</div>
            <div className="sv-queue__meta">
              {session.repoPath.split('/').pop()} · {session.runtimeState.replace('_', ' ')} ·{' '}
              {formatElapsed(Math.max(0, now - session.stateSince))} · {cost(session)}
              {diff(session) !== null && ` · ${diff(session)}`}
            </div>
            {session.pendingPermission !== null && (
              <div className="sv-row__trigger">
                Waiting on you: {session.pendingPermission.summary}
              </div>
            )}
          </span>

          <span className="sv-queue__actions">
            <button className="sv-queue__btn" onClick={() => onOpen(session.id)}>
              <ExternalLink aria-hidden="true" /> Open
            </button>
            {RUNNING.has(session.runtimeState) && (
              // Stopping keeps the working copy and whatever it changed: you
              // stop an agent to look at what it did, not to lose it.
              <StopControl onStop={(reason) => onStop(session.id, reason)} />
            )}
            <button className="sv-queue__btn" onClick={() => onDiscard(session.id)}>
              <Trash2 aria-hidden="true" /> Discard
            </button>
          </span>
        </div>
      ))}

      <div className="sv-form">
        <span className="sv-field__note">
          Stopping ends the run and keeps the working copy, so you can review what it did. Its
          reason goes to the agent and into the feed, so a half-finished diff still says why it
          stopped. Discarding also removes the working copy and takes the session off the console.
        </span>
      </div>
    </div>
  )
}
