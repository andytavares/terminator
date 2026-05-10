import React from 'react'
import type { RiskScore } from '../../schemas/pr-review.schema'

interface Props {
  riskScore: RiskScore
  ciStatus?: 'passing' | 'failing' | 'pending' | 'none'
  lintStatus?: 'pass' | 'fail' | 'warn' | 'unknown'
  coverageStatus?: 'pass' | 'fail' | 'warn' | 'unknown'
}

interface Chip {
  label: string
  tooltip: string
  value: string | null
  status: 'pass' | 'warn' | 'fail' | 'unknown'
}

export function HealthChips({ riskScore, ciStatus, lintStatus, coverageStatus }: Props) {
  const { metrics } = riskScore

  const ciChipStatus: Chip['status'] =
    ciStatus === 'passing'
      ? 'pass'
      : ciStatus === 'failing'
        ? 'fail'
        : ciStatus === 'pending'
          ? 'warn'
          : 'unknown'

  const ciChipValue =
    ciStatus === 'passing'
      ? 'passing'
      : ciStatus === 'failing'
        ? 'failing'
        : ciStatus === 'pending'
          ? 'pending'
          : null

  // Prefer per-file coverage from metrics, fall back to PR-level coverageStatus
  const covPct = metrics.patchCoverage
  const covStatus: Chip['status'] =
    covPct != null
      ? covPct >= 80
        ? 'pass'
        : covPct >= 50
          ? 'warn'
          : 'fail'
      : (coverageStatus ?? 'unknown')
  const covValue = covPct != null ? `${covPct}%` : null

  const chips: Chip[] = [
    {
      label: 'Tests',
      tooltip: 'Whether a test file exists alongside this changed file.',
      value:
        metrics.testFilePresent == null ? null : metrics.testFilePresent ? 'present' : 'missing',
      status:
        metrics.testFilePresent == null ? 'unknown' : metrics.testFilePresent ? 'pass' : 'fail',
    },
    {
      label: 'Complexity',
      tooltip:
        'Cyclomatic complexity delta — how much more complex this file became after the change. ≤0=pass, <5=warn, ≥5=fail.',
      value:
        metrics.complexityDelta == null
          ? null
          : metrics.complexityDelta === 0
            ? '±0'
            : metrics.complexityDelta > 0
              ? `+${metrics.complexityDelta}`
              : `${metrics.complexityDelta}`,
      status:
        metrics.complexityDelta == null
          ? 'unknown'
          : metrics.complexityDelta <= 0
            ? 'pass'
            : metrics.complexityDelta < 5
              ? 'warn'
              : 'fail',
    },
    {
      label: 'Coverage',
      tooltip:
        'Patch coverage — percentage of changed lines covered by tests. ≥80%=pass, ≥50%=warn, <50%=fail.',
      value: covValue,
      status: covStatus,
    },
    {
      label: 'Lint',
      tooltip: 'Lint status for this file — whether the linter reports errors or warnings.',
      value:
        lintStatus === 'pass'
          ? 'clean'
          : lintStatus === 'fail'
            ? 'errors'
            : lintStatus === 'warn'
              ? 'warnings'
              : null,
      status: lintStatus ?? 'unknown',
    },
    {
      label: 'CI',
      tooltip: 'Continuous integration pipeline status for this PR.',
      value: ciChipValue,
      status: ciChipStatus,
    },
    {
      label: 'Churn',
      tooltip:
        'File churn rate — how many times this file was changed in the last 90 days. ≤5=pass, ≤20=warn, >20=fail.',
      value: metrics.churn90d == null ? null : `${metrics.churn90d}x/90d`,
      status:
        metrics.churn90d == null
          ? 'unknown'
          : metrics.churn90d <= 5
            ? 'pass'
            : metrics.churn90d <= 20
              ? 'warn'
              : 'fail',
    },
    {
      label: 'Blast',
      tooltip:
        'Blast radius — number of other files that import this file. ≤5=pass, ≤30=warn, >30=fail.',
      value: metrics.blastRadius == null ? null : `${metrics.blastRadius} importers`,
      status:
        metrics.blastRadius == null
          ? 'unknown'
          : metrics.blastRadius <= 5
            ? 'pass'
            : metrics.blastRadius <= 30
              ? 'warn'
              : 'fail',
    },
  ]

  return (
    <div className="health-chips" role="list" aria-label="File health signals">
      {chips.map((chip) => (
        <div
          key={chip.label}
          className={`health-chip health-chip--${chip.status}`}
          role="listitem"
          title={chip.tooltip}
        >
          <span className="health-chip-label">{chip.label}</span>
          <span className="health-chip-value">{chip.value ?? '?'}</span>
        </div>
      ))}
    </div>
  )
}
