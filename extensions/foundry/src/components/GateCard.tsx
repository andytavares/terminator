import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { defaultInWords } from '../gates/rules.js'
import type { Gate } from '../gates/rules.js'
import { gradeInWords } from '../runtime/review/risk-grader.js'
import { GateEvidence } from './GateEvidence.js'
import { RaiseBudgetForm } from './BudgetForm.js'
import { Markdown } from './Markdown.js'
import { OrderLinks } from './OrderLinks.js'

// One gate, one line.
//
// What it asks, what it is about and the answers fit on a single row; why it
// fired and what it saw open underneath on a click. Gates used to print the
// whole reason, the evidence and the options on every row, so a queue of six
// was a page of text before the first answer.

export interface GateCardProps {
  readonly gate: Gate
  /** True while an answer is being sent: every control waits. */
  readonly busy?: boolean
  /** `limit` is only set for a raise: the new budget, or null for no limit. */
  readonly onDecide: (option: string, limit?: number | null) => void
  readonly pulls?: readonly { readonly number: number; readonly url: string }[]
  readonly source?: { readonly key: string; readonly url: string } | null
  /** What leads the row when several orders share a list: an icon, the rule's name. */
  readonly lead?: React.ReactNode
  /** Further facts for the line under the question: which order, how many units wait. */
  readonly meta?: React.ReactNode
  readonly className?: string
}

export interface GateAnswersProps {
  readonly gate: Pick<Gate, 'options' | 'breach'>
  readonly busy?: boolean
  readonly onDecide: (option: string) => void
  /**
   * Called for a raise, which needs a limit typed in. A surface with no form
   * for it leaves this off and the raise is not offered there at all.
   */
  readonly onRaise?: () => void
}

/**
 * The gate's answers as buttons, shared by the gate card and by any row that
 * carries a gate's answers inline.
 *
 * One recommended answer, not all of them: every rule lists the affirmative one
 * first, and drawing the ways of stopping as loudly makes the operator read
 * every button to find the one that keeps the work alive.
 */
export function GateAnswers({
  gate,
  busy = false,
  onDecide,
  onRaise,
}: GateAnswersProps): JSX.Element {
  return (
    <div className="fdry-gate-actions">
      {gate.options.map((option, index) => {
        const raise = option.id === 'raise' && Boolean(gate.breach)
        if (raise && onRaise === undefined) return null
        return (
          <button
            key={option.id}
            type="button"
            title={option.consequence}
            disabled={busy}
            className={index === 0 ? 'is-primary' : undefined}
            onClick={() => (raise ? onRaise?.() : onDecide(option.id))}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function GateCard({
  gate,
  busy = false,
  onDecide,
  pulls = [],
  source = null,
  lead,
  meta,
  className,
}: GateCardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [raising, setRaising] = useState(false)

  const decide = (option: string, limit?: number | null): void => {
    setRaising(false)
    if (limit === undefined) onDecide(option)
    else onDecide(option, limit)
  }

  return (
    <div className={`fdry-gate-card${open || raising ? ' is-open' : ''} ${className ?? ''}`.trim()}>
      {/* The whole row opens the gate, but a control on it does its own job. */}
      <div
        className="fdry-gate-row"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, a, input') === null) {
            setOpen((was) => !was)
          }
        }}
      >
        <button
          type="button"
          className="fdry-gate-chevron"
          aria-expanded={open}
          aria-label={open ? 'Hide the reason' : 'Show the reason'}
          onClick={() => setOpen((was) => !was)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
        {lead}
        <div className="fdry-gate-text">
          <b className="fdry-gate-summary" title={gate.summary}>
            {gate.summary}
          </b>
          <div className="fdry-gate-meta">
            {meta}
            <span>{gradeInWords(gate.riskGrade)}</span>
            <OrderLinks pulls={pulls} source={source} />
            <span className="fdry-gate-default">
              If nobody answers: {defaultInWords(gate)}
              {gate.deadline === null ? ' (it waits for you)' : ''}
            </span>
          </div>
        </div>
        {raising ? null : (
          <GateAnswers
            gate={gate}
            busy={busy}
            onDecide={(option) => decide(option)}
            onRaise={() => setRaising(true)}
          />
        )}
      </div>

      {open || raising ? (
        <div className="fdry-gate-detail">
          {open ? (
            <>
              <Markdown text={gate.why} />
              <GateEvidence evidence={gate.evidence} />
              <ul className="fdry-gate-consequences">
                {gate.options.map((option) => (
                  <li key={option.id}>
                    <b>{option.label}</b> {option.consequence}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {raising && gate.breach ? (
            <RaiseBudgetForm
              breach={gate.breach}
              disabled={busy}
              onRaise={(limit) => decide('raise', limit)}
              onCancel={() => setRaising(false)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
