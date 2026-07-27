import React, { useState } from 'react'
import { CornerDownLeft, Trash2 } from 'lucide-react'
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
  /** Ends a session and takes it off the queue (FR-029). */
  onDiscard(sessionId: string): void
  /** Answers a request that is a question rather than a yes/no (FR-007). */
  onAnswer(sessionId: string, requestId: string, answer: string): void
  onOpen(sessionId: string): void
}

/** True when every part of the ask is already offered as a button below. */
function hasAnswerableOptions(
  permission: NonNullable<AttentionItem['pendingPermission']>
): boolean {
  const questions = permission.questions ?? []
  return questions.length > 0 && questions.every((entry) => entry.options.length > 0)
}

/** A request the agent expects words back from, rather than a yes or no. */
function isQuestion(permission: NonNullable<AttentionItem['pendingPermission']>): boolean {
  return (
    (permission.questions?.length ?? 0) > 0 ||
    permission.toolName.toLowerCase().includes('question')
  )
}

/** Reasons a session is on the queue with nothing left to wait for. */
const ENDABLE: ReadonlySet<AttentionItem['reason']> = new Set(['failed', 'unknown'])

const REASON_TITLES: Record<AttentionItem['reason'], string> = {
  needs_input: 'Waiting on you',
  stalled: 'Stopped making progress',
  failed: 'Failed',
  ready: 'Ready to review',
  unknown: 'State unknown',
}

/**
 * Answering a request that is a question.
 *
 * A question with options is not a yes/no — approving it tells the agent
 * nothing about which option you meant. The options are offered as answers,
 * and there is always a free-text box, because the useful answer is often none
 * of the offered ones.
 */
function AnswerControls({
  questions,
  onAnswer,
}: {
  questions: ReadonlyArray<{ question: string; options: readonly string[] }> | undefined
  onAnswer(answer: string): void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const asked = questions ?? []
  const hasOptions = asked.some((entry) => entry.options.length > 0)

  const send = (): void => {
    if (draft.trim() === '') return
    onAnswer(draft.trim())
    setDraft('')
  }

  return (
    <div className="sv-answer">
      {asked.map((entry, index) => (
        <div className="sv-answer__question" key={`${entry.question}-${index}`}>
          {/* Named when there is more than one: a bare label would not say
              which question it answers, and the agent gets only the text. */}
          {asked.length > 1 && entry.question !== '' && (
            <div className="sv-answer__label">{entry.question}</div>
          )}
          <div className="sv-answer__options">
            {entry.options.map((option) => (
              <button
                key={option}
                className="sv-queue__btn"
                onClick={() =>
                  onAnswer(
                    asked.length > 1 && entry.question !== ''
                      ? `${entry.question} — ${option}`
                      : option
                  )
                }
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="sv-answer__row">
        <input
          aria-label="Answer"
          placeholder={hasOptions ? 'or answer in your own words…' : 'answer…'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') send()
          }}
        />
        <button
          className="sv-queue__btn sv-btn--primary"
          disabled={draft.trim() === ''}
          onClick={send}
        >
          <CornerDownLeft aria-hidden="true" /> Send
        </button>
      </div>
    </div>
  )
}

export function AttentionQueue({
  items,
  loaded,
  workingCount,
  onApprove,
  onDeny,
  onAnswer,
  onDiscard,
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
            {/* The branch, not the state repeated: three rows all reading
                "State unknown" are indistinguishable, and the state is on the
                line below anyway. */}
            <div className="sv-queue__title">{item.pendingPermission?.summary ?? item.branch}</div>
            <div className="sv-queue__meta">
              {/* Which tool is asking. A command and a file write read alike
                  from their arguments alone. */}
              {item.pendingPermission !== null && (
                <>
                  <span className="sv-tool">{item.pendingPermission.toolName}</span>{' '}
                </>
              )}
              {item.repoPath.split('/').pop()} · {REASON_TITLES[item.reason]} ·{' '}
              {formatElapsed(item.waitingMs)}
              {item.pendingPermission?.targetHost !== undefined && (
                <> · host {item.pendingPermission.targetHost}</>
              )}
            </div>
            {/* The ask in full. You cannot decide what you cannot read, and
                a summary of an unfamiliar tool is its name, not its request
                (FR-007). */}
            {/* Skipped when the questions are rendered as answerable buttons
                below — the block would repeat them verbatim. */}
            {item.pendingPermission?.detail != null &&
              item.pendingPermission.detail.trim() !== '' &&
              !hasAnswerableOptions(item.pendingPermission) && (
                <pre className="sv-queue__detail">{item.pendingPermission.detail}</pre>
              )}
            {item.reason === 'unknown' && (
              // Honest about what it means, and about what happens next: a row
              // saying only "State unknown" leaves the operator with nothing to
              // decide.
              <div className="sv-row__trigger">
                It was running when the console last closed. The agent did not survive; the console
                re-reads its record and will update this if it can.
              </div>
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

          {/* Every row can be acted on. A session that is over, or that the
              console lost track of, had no action at all — so it sat on the
              queue forever. */}
          {item.pendingPermission === null && ENDABLE.has(item.reason) && (
            <div className="sv-queue__actions">
              <button className="sv-queue__btn" onClick={() => onDiscard(item.sessionId)}>
                <Trash2 aria-hidden="true" /> Discard
              </button>
            </div>
          )}

          {item.pendingPermission !== null && (
            <div className="sv-queue__respond">
              {/* A question is answered, not approved. Allow/Deny is the right
                  control for "may I run this"; it is the wrong one for "which
                  of these did you mean" (FR-007). */}
              {isQuestion(item.pendingPermission) ? (
                <AnswerControls
                  questions={item.pendingPermission.questions}
                  onAnswer={(answer) =>
                    onAnswer(item.sessionId, item.pendingPermission!.requestId, answer)
                  }
                />
              ) : (
                <>
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
                  {/* Denying with a reason is worth more to the agent than a
                      bare refusal, and costs a sentence. */}
                  <AnswerControls
                    questions={undefined}
                    onAnswer={(answer) =>
                      onAnswer(item.sessionId, item.pendingPermission!.requestId, answer)
                    }
                  />
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
