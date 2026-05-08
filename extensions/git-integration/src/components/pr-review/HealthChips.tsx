import React from 'react'
import type { RiskScore } from '../../../../../src/shared/schemas/pr-review.schema'

interface Props {
  riskScore: RiskScore
}

interface Chip {
  label: string
  value: string | null
  status: 'pass' | 'warn' | 'fail' | 'unknown'
}

export function HealthChips({ riskScore }: Props) {
  const { metrics } = riskScore

  const chips: Chip[] = [
    {
      label:  'Tests',
      value:  metrics.testFilePresent == null ? null : metrics.testFilePresent ? 'present' : 'missing',
      status: metrics.testFilePresent == null ? 'unknown' : metrics.testFilePresent ? 'pass' : 'fail',
    },
    {
      label:  'Complexity',
      value:  metrics.complexityDelta == null ? null
              : metrics.complexityDelta === 0 ? '±0'
              : metrics.complexityDelta > 0 ? `+${metrics.complexityDelta}` : `${metrics.complexityDelta}`,
      status: metrics.complexityDelta == null ? 'unknown'
              : metrics.complexityDelta <= 0 ? 'pass'
              : metrics.complexityDelta < 5 ? 'warn' : 'fail',
    },
    {
      label:  'Coverage',
      value:  metrics.patchCoverage == null ? null : `${metrics.patchCoverage}%`,
      status: metrics.patchCoverage == null ? 'unknown'
              : metrics.patchCoverage >= 80 ? 'pass'
              : metrics.patchCoverage >= 50 ? 'warn' : 'fail',
    },
    {
      label:  'Lint',
      value:  null,
      status: 'unknown',
    },
    {
      label:  'CI',
      value:  null,
      status: 'unknown',
    },
    {
      label:  'Churn',
      value:  metrics.churn90d == null ? null : `${metrics.churn90d}x/90d`,
      status: metrics.churn90d == null ? 'unknown'
              : metrics.churn90d <= 5 ? 'pass'
              : metrics.churn90d <= 20 ? 'warn' : 'fail',
    },
    {
      label:  'Blast',
      value:  metrics.blastRadius == null ? null : `${metrics.blastRadius} importers`,
      status: metrics.blastRadius == null ? 'unknown'
              : metrics.blastRadius <= 5 ? 'pass'
              : metrics.blastRadius <= 30 ? 'warn' : 'fail',
    },
  ]

  return (
    <div className="health-chips" role="list" aria-label="File health signals">
      {chips.map(chip => (
        <div
          key={chip.label}
          className={`health-chip health-chip--${chip.status}`}
          role="listitem"
          title={chip.label}
        >
          <span className="health-chip-label">{chip.label}</span>
          <span className="health-chip-value">{chip.value ?? '?'}</span>
        </div>
      ))}
    </div>
  )
}
