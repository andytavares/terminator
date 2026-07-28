import React, { useState } from 'react'
import { Bot, Monitor, BellOff, X } from 'lucide-react'
import type { FeedEntry } from '../../../shared/supervision/view-types.js'
import './supervision.css'

// Concept 07. Chronological, written summaries rather than raw transcript
// (FR-091), with authorship visible: an entry Terminator wrote must never read
// as though the agent said it (FR-092). That distinction is the whole reason a
// stall notice is trustworthy.

export interface StandupFeedProps {
  entries: readonly FeedEntry[]
  mutedSessions: readonly string[]
  onReply(sessionId: string, message: string): void
  onToggleMute(sessionId: string): void
  /** Removes one entry. A record you cannot prune becomes noise (FR-093). */
  onRemove(id: string): void
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function StandupFeed({
  entries,
  mutedSessions,
  onReply,
  onToggleMute,
  onRemove,
}: StandupFeedProps): JSX.Element {
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (entries.length === 0) {
    return <div className="sv-allclear">Nothing has happened yet.</div>
  }

  const send = (sessionId: string): void => {
    if (draft.trim() === '') return
    onReply(sessionId, draft.trim())
    setDraft('')
    setReplyTo(null)
  }

  return (
    <div className="sv-panel">
      {entries.map((entry) => (
        <div className="sv-feed__entry" key={entry.id}>
          <div className={`sv-feed__author sv-feed__author--${entry.author}`}>
            {entry.author === 'console' ? (
              <>
                <Monitor aria-hidden="true" /> Terminator
              </>
            ) : (
              <>
                <Bot aria-hidden="true" /> agent
              </>
            )}
            <span> · {formatTime(entry.at)}</span>
            {mutedSessions.includes(entry.sessionId) && (
              <span>
                {' '}
                · <BellOff aria-hidden="true" /> muted
              </span>
            )}
          </div>

          <div className="sv-feed__summary">{entry.summary}</div>

          <div className="sv-queue__actions">
            {/* Only an agent entry can be replied to — replying to a console
                entry would go nowhere, so the affordance is not offered. */}
            {entry.replyable && replyTo !== entry.id && (
              <button className="sv-queue__btn" onClick={() => setReplyTo(entry.id)}>
                Reply
              </button>
            )}
            <button className="sv-queue__btn" onClick={() => onToggleMute(entry.sessionId)}>
              {mutedSessions.includes(entry.sessionId) ? 'Unmute' : 'Mute'}
            </button>
            <button className="sv-queue__btn" onClick={() => onRemove(entry.id)}>
              <X aria-hidden="true" /> Remove
            </button>
          </div>

          {replyTo === entry.id && (
            <div className="sv-queue__actions">
              <input
                aria-label={`Reply to ${entry.sessionId}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send(entry.sessionId)
                }}
              />
              <button className="sv-queue__btn" onClick={() => send(entry.sessionId)}>
                Send
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
