import React from 'react'
import { Check, Loader2, Eye } from 'lucide-react'
import type { PhaseId, PhaseState } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'

type NodeClass = 'done' | 'active' | 'review' | 'locked' | 'pending'

function statusToClass(status: PhaseState['status']): NodeClass {
  switch (status) {
    case 'approved':
      return 'done'
    case 'running':
      return 'active'
    case 'awaiting_review':
      return 'review'
    case 'locked':
    case 'stale':
      return 'locked'
    default:
      return 'pending'
  }
}

interface PhaseRailProps {
  phases: Record<PhaseId, PhaseState>
  activePhase?: PhaseId
}

export function PhaseRail({ phases, activePhase }: PhaseRailProps) {
  return (
    <ol
      style={{
        display: 'flex',
        gap: '4px',
        listStyle: 'none',
        padding: 0,
        margin: 0,
        alignItems: 'center',
      }}
    >
      {PHASE_ORDER.map((id, idx) => {
        const phaseState = phases[id]
        const cls = statusToClass(phaseState?.status ?? 'locked')
        const isActive = activePhase === id || phaseState?.status === 'running'

        return (
          <li
            key={id}
            data-testid={`phase-node-${id}`}
            className={isActive ? `phase-node active` : `phase-node ${cls}`}
            title={id}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              background:
                cls === 'done'
                  ? 'var(--tm-success, #22c55e)'
                  : cls === 'active' || isActive
                    ? 'var(--tm-accent, #3b82f6)'
                    : cls === 'review'
                      ? 'var(--tm-warning, #f59e0b)'
                      : cls === 'locked'
                        ? 'var(--tm-muted, #374151)'
                        : 'var(--tm-bg-elevated)',
              color: 'var(--tm-text-primary)',
              position: 'relative',
            }}
          >
            {cls === 'done' ? (
              <Check size={12} />
            ) : cls === 'active' ? (
              <Loader2 size={12} />
            ) : cls === 'review' ? (
              <Eye size={12} />
            ) : (
              idx + 1
            )}
          </li>
        )
      })}
    </ol>
  )
}
