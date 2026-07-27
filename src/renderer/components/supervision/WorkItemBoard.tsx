import React from 'react'
import { FileText, Map, ListChecks, Check, Minus, AlertTriangle } from 'lucide-react'
import type { WorkItemView as WorkItemContract } from '../../../shared/supervision/view-types.js'
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

export interface WorkItemBoardProps {
  items: readonly BoardItem[]
  unreadable: ReadonlyArray<{ filePath: string; reason: string }>
  conflicts: ReadonlyArray<{ workItemId: string; producers: string[] }>
  /** False when no producer registered the action, rendering the card read-only. */
  canAct: boolean
  onOpen(workItemId: string): void
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
  items,
  unreadable,
  conflicts,
  canAct,
  onOpen,
}: WorkItemBoardProps): JSX.Element {
  if (items.length === 0 && unreadable.length === 0) {
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
              <button className="sv-row" key={item.id} onClick={() => onOpen(item.id)}>
                <span className="sv-row__main">
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
                </span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}
