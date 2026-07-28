import React, { useState } from 'react'
import { Square, Trash2, ChevronDown, ChevronRight, TerminalSquare } from 'lucide-react'
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
  /** Ends it and removes the working copy, and the branch with it. */
  onDiscard(sessionId: string): void
  /** Told when a session is expanded, so the shell can follow if it wants to. */
  onOpen(sessionId: string): void
  /**
   * Goes to the terminal the agent is running in, so the operator can watch it
   * and take the work over by typing in it.
   */
  onAttach(session: SupervisedSession): void
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

/** Everything the console knows about one session, in the order you would ask. */
function describe(session: SupervisedSession, now: number): string {
  const lines = [
    `branch:      ${session.branch}`,
    `repository:  ${session.repoPath}`,
    `working copy:${session.worktreePath === '' ? ' not provisioned' : ` ${session.worktreePath}`}`,
    `state:       ${session.runtimeState} for ${formatElapsed(Math.max(0, now - session.stateSince))}`,
    `autonomy:    ${session.autonomyLevel}`,
    `spent:       ${cost(session)}`,
    `diff:        ${diff(session) ?? 'nothing changed yet'}`,
  ]

  if (session.lastToolActivityAt !== null) {
    lines.push(`last tool:   ${formatElapsed(Math.max(0, now - session.lastToolActivityAt))} ago`)
  }
  if (session.workItemId !== null) {
    lines.push(
      `work item:   ${session.workItemId}${session.laneOrd !== null ? ` · lane ${session.laneOrd}` : ''}`
    )
  }
  if (session.terminalSessionId !== null) lines.push(`terminal:    ${session.terminalSessionId}`)
  if (session.transcriptPath !== null) lines.push(`transcript:  ${session.transcriptPath}`)
  if (session.pendingPermission !== null) {
    lines.push(`waiting on:  ${session.pendingPermission.summary}`)
  }
  if (session.failure !== null) {
    lines.push(
      `failed:      ${session.failure.step}${
        session.failure.exitCode !== null ? ` exited ${session.failure.exitCode}` : ''
      }`,
      session.failure.output.trim() === '' ? '' : session.failure.output.trim()
    )
  }

  return lines.filter((line) => line !== '').join('\n')
}

export function SessionList({
  sessions,
  now,
  onStop,
  onDiscard,
  onOpen,
  onAttach,
}: SessionListProps): JSX.Element {
  // Expanded in place. "Open" used to call out to the app shell, which never
  // listened, so it did nothing at all — and there is no other surface that
  // shows one session's own detail.
  const [expanded, setExpanded] = useState<string | null>(null)

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
            <button
              className="sv-queue__btn"
              aria-expanded={expanded === session.id}
              onClick={() => {
                const next = expanded === session.id ? null : session.id
                setExpanded(next)
                if (next !== null) onOpen(session.id)
              }}
            >
              {expanded === session.id ? (
                <ChevronDown aria-hidden="true" />
              ) : (
                <ChevronRight aria-hidden="true" />
              )}
              Details
            </button>
            {session.terminalSessionId !== null && (
              // The agent is running in a terminal, in its own project. This
              // goes to it, rather than opening a second shell beside it.
              <button className="sv-queue__btn" onClick={() => onAttach(session)}>
                <TerminalSquare aria-hidden="true" /> Terminal
              </button>
            )}
            {RUNNING.has(session.runtimeState) && (
              // Stopping keeps the working copy and whatever it changed: you
              // stop an agent to look at what it did, not to lose it.
              <StopControl onStop={(reason) => onStop(session.id, reason)} />
            )}
            <button className="sv-queue__btn" onClick={() => onDiscard(session.id)}>
              <Trash2 aria-hidden="true" /> Discard
            </button>
          </span>

          {expanded === session.id && (
            <pre className="sv-queue__detail sv-session__detail">{describe(session, now)}</pre>
          )}
        </div>
      ))}

      <div className="sv-form">
        <span className="sv-field__note">
          Terminal goes to the session&rsquo;s own terminal, where the agent is running — you can
          watch it and take over by typing in it. Stopping ends the run and keeps the working copy,
          so you can review what it did. Its reason goes to the agent and into the feed, so a
          half-finished diff still says why it stopped. Discarding also removes the working copy,
          deletes the branch it was on, and takes the session off the console.
        </span>
      </div>
    </div>
  )
}
