import React, { useState } from 'react'
import {
  ExternalLink,
  X,
  FileText,
  Map,
  ListChecks,
  Check,
  Minus,
  AlertTriangle,
  ThumbsUp,
  Undo2,
  ChevronRight,
  Play,
} from 'lucide-react'
import type { WorkItemView as WorkItemContract } from '../../../shared/supervision/view-types.js'
import { gateIsReviewable } from '../../../shared/supervision/gate-reviewable.js'
import './supervision.css'

// Concept 02. Derived entirely from the published contract, so it behaves
// identically whichever producer wrote it — and works for a hand-written JSON
// file (FR-080). No producer is special-cased anywhere in this file.

const PHASES = [
  'intake',
  'specify',
  'clarify',
  'plan',
  'tasks',
  'implement',
  'review',
  'merged',
] as const

export interface BoardItem {
  readonly item: WorkItemContract
  readonly producerId: string
}

/** A ticket taken in but not yet planned: it has no lanes and no artefacts. */
export interface QueuedIntakeView {
  readonly id: string
  readonly source: 'linear' | 'github' | 'local'
  readonly sourceUrl: string | null
  readonly title: string
  readonly createdAt: number
}

export interface WorkItemBoardProps {
  /** Tickets queued but not yet planned by any producer. */
  queued: readonly QueuedIntakeView[]
  onRemoveQueued(id: string): void
  /**
   * Takes the ticket to the start panel with what it says already filled in.
   *
   * Not a start in itself: the repository and the branch are still the
   * operator's to choose, and auto-starting on intake is what produces the
   * backlog nobody can review (FR-069). But a queued ticket with no way to act
   * on it is a list, not a queue.
   */
  onStartQueued(ticket: QueuedIntakeView): void
  items: readonly BoardItem[]
  unreadable: ReadonlyArray<{ filePath: string; reason: string }>
  conflicts: ReadonlyArray<{ workItemId: string; producers: string[] }>
  /** False when no producer registered the action, rendering the card read-only. */
  canAct: boolean
  onOpen(workItemId: string): void
  /** FR-083: implementation cannot begin until these are approved by a human. */
  onApproveGate(workItemId: string, gate: string): void
  /** FR-084: rejection carries the notes back to the producer. */
  onRejectGate(workItemId: string, gate: string, notes: string): void
  onSendBack(workItemId: string, phase: string, notes: string): void
  onAdvancePhase(workItemId: string): void
  actionError: string | null
  onDismissActionError(): void
}

const GATES = [
  { key: 'spec_approved_by_human', label: 'spec approved', phase: 'specify' },
  { key: 'plan_approved_by_human', label: 'plan approved', phase: 'plan' },
] as const

/**
 * The gate controls. Approving is one click; rejecting is deliberately not —
 * sending work back without saying why is what produced the unbounded-scope
 * failures this gate exists to prevent (FR-084).
 */
function GateActions({
  item,
  onApproveGate,
  onRejectGate,
  onSendBack,
  onAdvancePhase,
}: {
  item: WorkItemContract
  onApproveGate: WorkItemBoardProps['onApproveGate']
  onRejectGate: WorkItemBoardProps['onRejectGate']
  onSendBack: WorkItemBoardProps['onSendBack']
  onAdvancePhase: WorkItemBoardProps['onAdvancePhase']
}): JSX.Element {
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  const reject = (gate: { key: string; phase: string }): void => {
    if (notes.trim() === '') return
    onRejectGate(item.id, gate.key, notes.trim())
    // Returning the item to the phase that produced the artefact is the other
    // half of the rejection — a rejected gate with the item left in `implement`
    // would leave the work unbounded.
    onSendBack(item.id, gate.phase, notes.trim())
    setNotes('')
    setRejecting(null)
  }

  return (
    <div className="sv-queue__actions">
      {GATES.filter(
        (gate) => item.gates[gate.key]?.ok !== true && gateIsReviewable(item.artifacts, gate.key)
      ).map((gate) => (
        <React.Fragment key={gate.key}>
          <button className="sv-queue__btn" onClick={() => onApproveGate(item.id, gate.key)}>
            <ThumbsUp aria-hidden="true" /> Approve {gate.label.replace(' approved', '')}
          </button>
          {rejecting === gate.key ? (
            <>
              <input
                aria-label={`Why are you rejecting the ${gate.label.replace(' approved', '')}?`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') reject(gate)
                }}
              />
              <button className="sv-queue__btn" onClick={() => reject(gate)}>
                Send back
              </button>
            </>
          ) : (
            <button className="sv-queue__btn" onClick={() => setRejecting(gate.key)}>
              <Undo2 aria-hidden="true" /> Reject {gate.label.replace(' approved', '')}
            </button>
          )}
        </React.Fragment>
      ))}
      <button className="sv-queue__btn" onClick={() => onAdvancePhase(item.id)}>
        <ChevronRight aria-hidden="true" /> Advance phase
      </button>
    </div>
  )
}

function ArtifactChips({ item }: { item: WorkItemContract }): JSX.Element {
  const chips: Array<{ label: string; icon: JSX.Element; present: boolean }> = [
    {
      label: 'spec',
      icon: <FileText aria-hidden="true" />,
      present: item.artifacts.spec !== undefined,
    },
    { label: 'plan', icon: <Map aria-hidden="true" />, present: item.artifacts.plan !== undefined },
    {
      label: 'tasks',
      icon: <ListChecks aria-hidden="true" />,
      present: item.artifacts.tasks !== undefined,
    },
  ]
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.label} className={`sv-chip${chip.present ? ' sv-chip--on' : ''}`}>
          {chip.icon}
          {chip.label}
          {chip.present ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}
        </span>
      ))}
    </>
  )
}

function GateChips({ item }: { item: WorkItemContract }): JSX.Element {
  const gates = [
    { key: 'spec_approved_by_human', label: 'spec approved' },
    { key: 'plan_approved_by_human', label: 'plan approved' },
  ]
  return (
    <>
      {gates.map((gate) => (
        <span
          key={gate.key}
          className={`sv-chip${item.gates[gate.key]?.ok === true ? ' sv-chip--on' : ''}`}
        >
          {item.gates[gate.key]?.ok === true ? (
            <Check aria-hidden="true" />
          ) : (
            <Minus aria-hidden="true" />
          )}
          {gate.label}
        </span>
      ))}
    </>
  )
}

export function WorkItemBoard({
  queued,
  onRemoveQueued,
  onStartQueued,
  items,
  unreadable,
  conflicts,
  canAct,
  onOpen,
  onApproveGate,
  onRejectGate,
  onSendBack,
  onAdvancePhase,
  actionError,
  onDismissActionError,
}: WorkItemBoardProps): JSX.Element {
  if (items.length === 0 && unreadable.length === 0 && queued.length === 0) {
    // No producer installed is not an error — sessions are still supervised as
    // ad-hoc work (FR-081).
    return (
      <div className="sv-allclear">
        No work items have been published. Sessions still run as ad-hoc work.
      </div>
    )
  }

  return (
    <div className="sv-panel">
      {actionError !== null && (
        <div className="sv-row">
          <span className="sv-warn">
            <AlertTriangle aria-hidden="true" />
            {actionError}
          </span>
          <button className="sv-queue__btn" onClick={onDismissActionError}>
            Dismiss
          </button>
        </div>
      )}

      {conflicts.map((conflict) => (
        <div className="sv-row" key={conflict.workItemId}>
          <span className="sv-warn">
            <AlertTriangle aria-hidden="true" />
            {/* Never silently resolved by picking one (FR-074). */}
            {conflict.workItemId} was published by {conflict.producers.join(' and ')} — resolve the
            duplicate before working it
          </span>
        </div>
      ))}

      {unreadable.map((bad) => (
        <div className="sv-row" key={bad.filePath}>
          <span className="sv-warn">
            <AlertTriangle aria-hidden="true" />
            Unreadable work item: {bad.reason}
          </span>
        </div>
      ))}

      {queued.length > 0 && (
        <section>
          <div className="sv-panel__header">
            <span>queued</span>
            <span>{queued.length}</span>
          </div>
          {queued.map((ticket) => (
            <div className="sv-row" key={ticket.id}>
              <span className="sv-row__main">
                <div className="sv-queue__title">{ticket.title}</div>
                <div className="sv-queue__meta">
                  {ticket.id} · {ticket.source} · not planned yet
                </div>
                {/* Nothing started. Auto-starting on intake is what produces
                    the backlog nobody can review (FR-069). */}
              </span>
              <span className="sv-queue__actions">
                <button
                  className="sv-queue__btn sv-btn--primary"
                  onClick={() => onStartQueued(ticket)}
                >
                  <Play aria-hidden="true" /> Start
                </button>
                {ticket.sourceUrl !== null && (
                  <a
                    className="sv-queue__btn"
                    href={ticket.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink aria-hidden="true" /> Open
                  </a>
                )}
                <button className="sv-queue__btn" onClick={() => onRemoveQueued(ticket.id)}>
                  <X aria-hidden="true" /> Remove
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      {PHASES.map((phase) => {
        const inPhase = items.filter((entry) => entry.item.phase === phase)
        if (inPhase.length === 0) return null
        return (
          <section key={phase}>
            <div className="sv-panel__header">
              <span>{phase}</span>
              <span>{inPhase.length}</span>
            </div>
            {inPhase.map(({ item }) => (
              <div className="sv-row" key={item.id}>
                <button className="sv-row__main" onClick={() => onOpen(item.id)}>
                  <div className="sv-queue__title">{item.title}</div>
                  <div className="sv-queue__meta">
                    {item.id} · {item.lanes.length}{' '}
                    {item.lanes.length === 1 ? 'repository' : 'repositories'}
                    {!canAct && ' · read-only: no producer provides actions'}
                  </div>
                  <div className="sv-queue__meta">
                    <ArtifactChips item={item} />
                    <GateChips item={item} />
                  </div>
                </button>
                {/* Read-only rather than broken when no producer registered a
                    command: the card still renders and says why (FR-078). */}
                {canAct && (
                  <GateActions
                    item={item}
                    onApproveGate={onApproveGate}
                    onRejectGate={onRejectGate}
                    onSendBack={onSendBack}
                    onAdvancePhase={onAdvancePhase}
                  />
                )}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
