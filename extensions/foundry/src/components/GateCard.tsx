import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { defaultInWords } from '../gates/rules.js'
import type { Gate } from '../gates/rules.js'
import { gradeInWords } from '../runtime/review/risk-grade.js'
import { GateEvidence } from './GateEvidence.js'
import { RaiseBudgetForm } from './BudgetForm.js'
import { Button, IconButton, Markdown } from '@terminator/extension-ui'
import { openInBrowser } from '@terminator/extension-sdk/renderer'
import { OrderLinks } from './OrderLinks.js'
import type { DocumentLink } from '../line/document-outcome.js'

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
  readonly document?: DocumentLink | null
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
          <Button
            key={option.id}
            size="sm"
            variant={index === 0 ? 'primary' : 'secondary'}
            title={option.consequence}
            disabled={busy}
            onClick={() => (raise ? onRaise?.() : onDecide(option.id))}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

export function GateCard(props: GateCardProps): JSX.Element {
  const { gate, busy = false, onDecide, className } = props
  const [open, setOpen] = useState(false)
  const [raising, setRaising] = useState(false)

  const decide = (option: string, limit?: number | null): void => {
    setRaising(false)
    if (limit === undefined) onDecide(option)
    else onDecide(option, limit)
  }

  return (
    <div className={`fdry-gate-card${open || raising ? ' is-open' : ''} ${className ?? ''}`.trim()}>
      <GateRow
        {...props}
        busy={busy}
        open={open}
        raising={raising}
        onToggle={() => setOpen((was) => !was)}
        onDecide={(option) => decide(option)}
        onRaise={() => setRaising(true)}
      />
      {open || raising ? (
        <GateDetail
          {...{ gate, busy, open, raising }}
          onRaise={(limit) => decide('raise', limit)}
          onCancel={() => setRaising(false)}
        />
      ) : null}
    </div>
  )
}

interface GateRowProps extends Omit<GateCardProps, 'onDecide'> {
  readonly busy: boolean
  readonly open: boolean
  readonly raising: boolean
  readonly onToggle: () => void
  readonly onDecide: (option: string) => void
  readonly onRaise: () => void
}

/** The gate's one line: what it asks, what it is about, and its answers. */
function GateRow({
  gate,
  busy,
  open,
  raising,
  lead,
  onToggle,
  onDecide,
  onRaise,
  ...facts
}: GateRowProps) {
  return (
    // The whole row opens the gate, but a control on it does its own job.
    <div
      className="fdry-gate-row"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a, input') === null) onToggle()
      }}
    >
      <GateChevron open={open} onToggle={onToggle} />
      {lead}
      <GateText gate={gate} {...facts} />
      {raising ? null : (
        <GateAnswers gate={gate} busy={busy} onDecide={onDecide} onRaise={onRaise} />
      )}
    </div>
  )
}

function GateChevron({
  open,
  onToggle,
}: {
  readonly open: boolean
  readonly onToggle: () => void
}) {
  return (
    <IconButton
      icon={ChevronRight}
      size="sm"
      className="fdry-gate-chevron"
      aria-expanded={open}
      label={open ? 'Hide the reason' : 'Show the reason'}
      onClick={onToggle}
    />
  )
}

/** The question, and the line of facts under it. */
function GateText({
  gate,
  meta,
  pulls = [],
  source = null,
  document = null,
}: Pick<GateCardProps, 'gate' | 'meta' | 'pulls' | 'source' | 'document'>) {
  return (
    <div className="fdry-gate-text">
      <b className="fdry-gate-summary" title={gate.summary}>
        {gate.summary}
      </b>
      <div className="fdry-gate-meta">
        {meta}
        <span>{gradeInWords(gate.riskGrade)}</span>
        <OrderLinks document={document} pulls={pulls} source={source} />
        <span className="fdry-gate-default">
          If nobody answers: {defaultInWords(gate)}
          {gate.deadline === null ? ' (it waits for you)' : ''}
        </span>
      </div>
    </div>
  )
}

interface GateDetailProps {
  readonly gate: Gate
  readonly busy: boolean
  readonly open: boolean
  readonly raising: boolean
  readonly onRaise: (limit: number | null) => void
  readonly onCancel: () => void
}

/** Under the row: why the gate fired and what it saw, or the form a raise needs. */
function GateDetail({ gate, busy, open, raising, onRaise, onCancel }: GateDetailProps) {
  return (
    <div className="fdry-gate-detail">
      {open ? (
        <>
          <Markdown fetchesNothing className="fdry-md" onOpenLink={openInBrowser}>
            {gate.why}
          </Markdown>
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
          onRaise={onRaise}
          onCancel={onCancel}
        />
      ) : null}
    </div>
  )
}
