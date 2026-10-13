import React from 'react'
import type { RiskScore } from '../../schemas/pr-review.schema'
import { choose, plural } from '../text'

interface Props {
  riskScore: RiskScore
  ciStatus?: 'passing' | 'failing' | 'pending' | 'none'
  lintStatus?: 'pass' | 'fail' | 'warn' | 'unknown'
  coverageStatus?: 'pass' | 'fail' | 'warn' | 'unknown'
  dryViolationCount?: number
}

const STATUS_ORDER: Record<Chip['status'], number> = {
  fail: 0,
  warn: 1,
  pass: 2,
  unknown: 3,
}

interface Chip {
  label: string
  tooltip: string
  value: string | null
  status: 'pass' | 'warn' | 'fail' | 'unknown'
}

type Status = Chip['status']
type Metrics = RiskScore['metrics']

/** 'pass' up to `passMax`, 'warn' up to `warnMax`, 'fail' above; 'unknown' when not measured. */
function bandStatus(value: number | null | undefined, passMax: number, warnMax: number): Status {
  if (value == null) return 'unknown'
  if (value <= passMax) return 'pass'
  if (value <= warnMax) return 'warn'
  return 'fail'
}

const CI_STATUS = new Map<string, Status>([
  ['passing', 'pass'],
  ['failing', 'fail'],
  ['pending', 'warn'],
])

const LINT_VALUE = new Map<string, string>([
  ['pass', 'clean'],
  ['fail', 'errors'],
  ['warn', 'warnings'],
])

function testsChip(metrics: Metrics): Chip {
  const present = metrics.testFilePresent
  const known = present != null
  return {
    label: 'Tests',
    tooltip: 'Whether a test file exists alongside this changed file.',
    value: choose(known, choose(present, 'present', 'missing'), null),
    status: choose<Status>(known, choose<Status>(present, 'pass', 'fail'), 'unknown'),
  }
}

function signedDelta(delta: number | null): string | null {
  if (delta == null) return null
  if (delta === 0) return '±0'
  if (delta > 0) return `+${delta}`
  return `${delta}`
}

function complexityStatus(delta: number | null): Status {
  if (delta == null) return 'unknown'
  if (delta <= 0) return 'pass'
  if (delta < 5) return 'warn'
  return 'fail'
}

function complexityChip(metrics: Metrics): Chip {
  return {
    label: 'Complexity',
    tooltip:
      'Cyclomatic complexity delta — how much more complex this file became after the change. ≤0=pass, <5=warn, ≥5=fail.',
    value: signedDelta(metrics.complexityDelta),
    status: complexityStatus(metrics.complexityDelta),
  }
}

function coverageStatusOf(covPct: number | null, fallback: Props['coverageStatus']): Status {
  if (covPct == null) return fallback ?? 'unknown'
  if (covPct >= 80) return 'pass'
  if (covPct >= 50) return 'warn'
  return 'fail'
}

/** Per-file coverage from the metrics, falling back to the PR-level coverage status. */
function coverageChip(metrics: Metrics, coverageStatus: Props['coverageStatus']): Chip {
  const covPct = metrics.patchCoverage
  return {
    label: 'Coverage',
    tooltip:
      'Patch coverage — percentage of changed lines covered by tests. ≥80%=pass, ≥50%=warn, <50%=fail.',
    value: choose(covPct != null, `${covPct}%`, null),
    status: coverageStatusOf(covPct, coverageStatus),
  }
}

function lintChip(lintStatus: Props['lintStatus']): Chip {
  return {
    label: 'Lint',
    tooltip: 'Lint status for this file — whether the linter reports errors or warnings.',
    value: LINT_VALUE.get(lintStatus ?? '') ?? null,
    status: lintStatus ?? 'unknown',
  }
}

function ciChip(ciStatus: Props['ciStatus']): Chip {
  const status = CI_STATUS.get(ciStatus ?? '') ?? 'unknown'
  return {
    label: 'CI',
    tooltip: 'Continuous integration pipeline status for this PR.',
    value: choose(status !== 'unknown', ciStatus ?? null, null),
    status,
  }
}

function churnChip(metrics: Metrics): Chip {
  const churn = metrics.churn90d
  return {
    label: 'Churn',
    tooltip:
      'File churn rate — how many times this file was changed in the last 90 days. ≤5=pass, ≤20=warn, >20=fail.',
    value: choose(churn != null, `${churn}x/90d`, null),
    status: bandStatus(churn, 5, 20),
  }
}

function blastChip(metrics: Metrics): Chip {
  const blast = metrics.blastRadius
  return {
    label: 'Blast',
    tooltip:
      'Blast radius — number of other files that import this file. ≤5=pass, ≤30=warn, >30=fail.',
    value: choose(blast != null, `${blast} importers`, null),
    status: bandStatus(blast, 5, 30),
  }
}

function duplicationValue(count: number | undefined): string | null {
  if (count == null) return null
  if (count === 0) return 'clean'
  return `${count} ${plural(count, 'dup')}`
}

function duplicationChip(count: number | undefined): Chip {
  return {
    label: 'Duplication',
    tooltip:
      'Duplicate code detection — similar blocks found in multiple files in this PR. 0=pass, warn if violations found.',
    value: duplicationValue(count),
    status: bandStatus(count, 0, Infinity),
  }
}

function healthChips(props: Props): Chip[] {
  const { metrics } = props.riskScore
  return [
    testsChip(metrics),
    complexityChip(metrics),
    coverageChip(metrics, props.coverageStatus),
    lintChip(props.lintStatus),
    ciChip(props.ciStatus),
    churnChip(metrics),
    blastChip(metrics),
    duplicationChip(props.dryViolationCount),
  ]
}

function chipText(chip: Chip): string {
  if (chip.status === 'unknown') return 'unknown'
  return chip.value ?? 'unknown'
}

export function HealthChips(props: Props) {
  const ordered = healthChips(props).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  return (
    <div className="health-list" aria-label="File health signals">
      <h3 className="health-list-title">Health</h3>
      <dl>
        {ordered.map((chip) => (
          <div key={chip.label} className="health-list-row" title={chip.tooltip}>
            <dt className="health-list-label">{chip.label}</dt>
            <dd
              className={`health-list-value health-list-value--${chip.status}`}
              data-status={chip.status}
            >
              {chipText(chip)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
