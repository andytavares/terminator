import React from 'react'
import type { PhaseId, PhaseStatus } from '../types/speckit.types.js'

const STATUS_GLYPH: Record<PhaseStatus, string> = {
  locked: '🔒',
  ready: '·',
  running: '⟳',
  awaiting_review: '◐',
  approved: '✓',
  stale: '~',
  modified: '!',
  failed: '✗',
}

const STATUS_LABEL: Record<PhaseStatus, string> = {
  locked: 'Locked',
  ready: 'Ready',
  running: 'Running',
  awaiting_review: 'Awaiting Review',
  approved: 'Approved',
  stale: 'Stale',
  modified: 'Modified',
  failed: 'Failed',
}

interface PhaseRowProps {
  phaseId: PhaseId
  status: PhaseStatus
  isSelected?: boolean
  onClick?: () => void
  cta?: React.ReactNode
}

export function PhaseRow({ phaseId, status, isSelected, onClick, cta }: PhaseRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 8px',
        cursor: 'pointer',
        background: isSelected
          ? 'var(--vscode-list-activeSelectionBackground, #094771)'
          : 'transparent',
        borderRadius: 4,
        gap: 8,
      }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      <span style={{ width: 20, textAlign: 'center' }}>{STATUS_GLYPH[status]}</span>
      <span style={{ flex: 1, textTransform: 'capitalize' }}>{phaseId}</span>
      <span style={{ fontSize: 11, opacity: 0.7 }}>{STATUS_LABEL[status]}</span>
      {cta && <span>{cta}</span>}
    </div>
  )
}
