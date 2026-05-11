import React, { useState } from 'react'
import type { PhaseId, PhaseState } from '../types/speckit.types.js'

interface StalePhase {
  id: PhaseId
  label: string
  state: PhaseState
  lastGeneratedAgainst: string
  canRegenerate: boolean
}

interface StalePropagationModalProps {
  changedPhase: PhaseId
  changedPhaseLabel: string
  stalePhases: StalePhase[]
  onReapproveAndQueue: (phasesToRerun: PhaseId[]) => Promise<void>
  onReapproveOnly: () => Promise<void>
  onRevert: () => Promise<void>
  onDismiss: () => void
}

const PHASE_COMMANDS: Record<PhaseId, string> = {
  constitution: '/speckit-constitution',
  specify: '/speckit-specify',
  clarify: '/speckit-clarify',
  plan: '/speckit-plan',
  checklist: '/speckit-checklist',
  tasks: '/speckit-tasks',
  analyze: '/speckit-analyze',
  implement: '/speckit-implement',
}

export function StalePropagationModal({
  changedPhase: _changedPhase,
  changedPhaseLabel,
  stalePhases,
  onReapproveAndQueue,
  onReapproveOnly,
  onRevert,
  onDismiss,
}: StalePropagationModalProps) {
  const [selected, setSelected] = useState<Set<PhaseId>>(
    new Set(stalePhases.filter((p) => p.canRegenerate).map((p) => p.id))
  )
  const [busy, setBusy] = useState(false)

  const toggle = (id: PhaseId) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const queuedPhases = stalePhases.filter((p) => selected.has(p.id))

  const handleQueue = async () => {
    setBusy(true)
    try {
      await onReapproveAndQueue(Array.from(selected))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sk-modal-overlay" onClick={onDismiss}>
      <div className="sk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sk-modal__header">
          <div className="sk-modal__title">Plan was edited — what do you want to do?</div>
          <button className="sk-icon-btn" onClick={onDismiss}>
            ✕
          </button>
        </div>
        <div className="sk-modal__body">
          <p className="sk-modal__desc">
            You modified <code>{changedPhaseLabel.toLowerCase()}</code> directly. Downstream phases
            were generated against an older version and are now stale.
          </p>

          <table className="sk-stale-table">
            <thead>
              <tr>
                <th>PHASE</th>
                <th>LAST GENERATED AGAINST</th>
                <th>DECISION</th>
              </tr>
            </thead>
            <tbody>
              {/* The changed phase itself */}
              <tr>
                <td>{changedPhaseLabel}</td>
                <td>
                  <code>previous version</code>
                </td>
                <td>
                  <span className="sk-badge sk-badge--review" style={{ fontSize: 10 }}>
                    Re-approve
                  </span>
                </td>
              </tr>
              {stalePhases.map((sp) => (
                <tr key={sp.id}>
                  <td>{sp.label}</td>
                  <td>
                    <code>{sp.lastGeneratedAgainst}</code>
                  </td>
                  <td>
                    {sp.canRegenerate ? (
                      <label className="sk-checkbox-label">
                        <input
                          type="checkbox"
                          checked={selected.has(sp.id)}
                          onChange={() => toggle(sp.id)}
                        />
                        Regenerate via <code>{PHASE_COMMANDS[sp.id]}</code>
                      </label>
                    ) : (
                      <span style={{ color: 'var(--tm-text-secondary)', fontSize: 11 }}>
                        Locked until upstream fresh
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sk-modal__footer">
          <button
            className="sk-btn sk-btn--primary"
            onClick={() => void handleQueue()}
            disabled={busy}
          >
            Re-approve {changedPhaseLabel} &amp; queue selected reruns
          </button>
          <button
            className="sk-btn sk-btn--secondary"
            onClick={() => void onReapproveOnly()}
            disabled={busy}
          >
            Re-approve only
          </button>
          <button className="sk-btn sk-btn--ghost" onClick={() => void onRevert()} disabled={busy}>
            Revert to previous version
          </button>
        </div>

        {queuedPhases.length > 0 && (
          <div className="sk-modal__queue-preview">
            <div className="sk-gate__title">Run queue (preview)</div>
            <ol className="sk-queue-list">
              <li>Re-approve {changedPhaseLabel} (manual) — you</li>
              {queuedPhases.map((p) => (
                <li key={p.id}>
                  <code>{PHASE_COMMANDS[p.id]}</code> — agent
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
