import React, { useState } from 'react'
import type { PendingAskView } from '../types/electron.js'

// What a supervised run is waiting on, and how you answer it.
//
// A phase holds every tool call at a PreToolUse hook until somebody decides.
// Without this surface the decision goes back to the terminal after five
// minutes, which works but makes the console a spectator of its own agents —
// and a run you have to babysit in a terminal is the thing the board exists to
// save you from.
//
// The whole ask is shown, not a summary of it. Approving on a one-line title is
// approving the half you cannot see, and a description is the agent's own
// account of what its command does rather than the command.

export interface PermissionQueueProps {
  pending: readonly PendingAskView[]
  /** Naming the card, since a request can come from any of them. */
  cardLabel?: (featureDir: string) => string
  onAllow(requestId: string): void
  onDeny(requestId: string, reason?: string): void
  /** Real words back to the agent, for an ask that is a question. */
  onAnswer(requestId: string, answer: string): void
  /** Hand it back to the terminal, to answer where the agent is. */
  onHandBack(requestId: string): void
}

function Ask({
  ask,
  label,
  onAllow,
  onDeny,
  onAnswer,
  onHandBack,
}: {
  ask: PendingAskView
  label: string
} & Omit<PermissionQueueProps, 'pending' | 'cardLabel'>): JSX.Element {
  const [answer, setAnswer] = useState('')
  const [showDetail, setShowDetail] = useState(false)

  const send = (): void => {
    const text = answer.trim()
    if (text === '') return
    setAnswer('')
    onAnswer(ask.requestId, text)
  }

  return (
    <div className="sk-ask">
      <div className="sk-ask__head">
        <span className="sk-ask__tool">{ask.toolName}</span>
        <span className="sk-ask__card">{label}</span>
        {ask.targetHost !== undefined && (
          <span className="sk-ask__host" title="Not on this repository's allowlist">
            {ask.targetHost}
          </span>
        )}
      </div>

      {/* The ask itself, not the name of the tool making it. */}
      <div className="sk-ask__summary">{ask.summary}</div>

      {ask.questions !== undefined &&
        ask.questions.map((question, index) => (
          <div className="sk-ask__question" key={index}>
            <div className="sk-ask__question-text">{question.question}</div>
            <div className="sk-ask__options">
              {question.options.map((option) => (
                // Answering with the option sends its words, so the agent
                // reads which one was chosen rather than a bare yes.
                <button
                  className="sk-ask__option"
                  key={option}
                  onClick={() => onAnswer(ask.requestId, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ))}

      {ask.detail !== null && (
        <>
          <button className="sk-ask__toggle" onClick={() => setShowDetail((v) => !v)}>
            {showDetail ? 'Hide the full request' : 'Show the full request'}
          </button>
          {showDetail && <pre className="sk-ask__detail">{ask.detail}</pre>}
        </>
      )}

      <div className="sk-ask__actions">
        <button className="sk-ask__allow" onClick={() => onAllow(ask.requestId)}>
          Allow
        </button>
        <button className="sk-ask__deny" onClick={() => onDeny(ask.requestId)}>
          Deny
        </button>
        <button
          className="sk-ask__hand-back"
          title="Answer it in the terminal, where you can see what the agent was doing"
          onClick={() => onHandBack(ask.requestId)}
        >
          Answer in terminal
        </button>
      </div>

      <div className="sk-ask__answer">
        <input
          aria-label={`Answer ${ask.toolName}`}
          placeholder="…or say something back"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') send()
          }}
        />
        <button onClick={send}>Send</button>
      </div>
    </div>
  )
}

export function PermissionQueue({
  pending,
  cardLabel,
  onAllow,
  onDeny,
  onAnswer,
  onHandBack,
}: PermissionQueueProps): JSX.Element {
  if (pending.length === 0) {
    // Asserted rather than implied. An empty panel and a panel that failed to
    // load look identical otherwise, and this one says "nothing is blocked".
    return (
      <div className="sk-asks sk-asks--clear">
        Nothing is waiting on you. Supervised runs ask here before they touch anything.
      </div>
    )
  }

  return (
    <div className="sk-asks">
      <div className="sk-asks__header">
        {pending.length} {pending.length === 1 ? 'run is' : 'runs are'} waiting on you
      </div>
      {/* Oldest first: the order they must be answered in, so one card cannot
          starve another by having asked most recently. */}
      {pending.map((ask) => (
        <Ask
          key={ask.requestId}
          ask={ask}
          label={cardLabel?.(ask.featureDir) ?? ask.featureDir.split('/').pop() ?? ''}
          onAllow={onAllow}
          onDeny={onDeny}
          onAnswer={onAnswer}
          onHandBack={onHandBack}
        />
      ))}
    </div>
  )
}
