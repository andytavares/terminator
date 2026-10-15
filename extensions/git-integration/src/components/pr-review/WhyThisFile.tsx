import React from 'react'
import { Flame, FlaskConical, Percent, Ruler, Share2, type LucideIcon } from 'lucide-react'
import { plural } from '@terminator/extension-sdk'
import type { RiskScore } from '../../schemas/pr-review.schema'
import { choose } from '../text'

import {
  BLAST_HIGH_IMPORTERS,
  BLAST_MEDIUM_IMPORTERS,
  CHANGE_HIGH_LINES,
  CHANGE_MEDIUM_LINES,
  CHURN_HIGH_COMMITS,
  CHURN_MEDIUM_COMMITS,
} from '../../review/risk-thresholds'

const THRESHOLDS = {
  churn90d: { medium: CHURN_MEDIUM_COMMITS, high: CHURN_HIGH_COMMITS },
  blastRadius: { medium: BLAST_MEDIUM_IMPORTERS, high: BLAST_HIGH_IMPORTERS },
  changeSize: { medium: CHANGE_MEDIUM_LINES, high: CHANGE_HIGH_LINES },
}

type Severity = 'high' | 'medium' | 'low' | 'fine'
type Band = { medium: number; high: number }
type Metrics = RiskScore['metrics']

interface Factor {
  key: string
  icon: LucideIcon
  title: string
  detail: string
  note: string
  severity: Severity
  /** Finishes "because it …" in the lead line; absent when the factor is fine. */
  reason?: string
}

export interface WhyThisFileProps {
  file: { path: string; riskScore: RiskScore; repoRoot: string }
}

function severityOf(value: number, band: Band): Severity {
  if (value >= band.high) return 'high'
  if (value >= band.medium) return 'medium'
  return 'low'
}

function thresholdNote(value: number, band: Band): string {
  return choose(value >= band.medium, `${band.medium} or more`, `under ${band.medium}`)
}

function churnFactor(churn: number | null): Factor {
  const band = THRESHOLDS.churn90d
  const known = churn ?? 0
  const severity = severityOf(known, band)
  return {
    key: 'churn',
    icon: Flame,
    title: choose(severity === 'low', 'How often it changes', 'Changes often'),
    detail: choose(
      churn == null,
      'Not measured',
      `${known} ${plural(known, 'commit')} in the last 90 days`
    ),
    note: choose(churn == null, 'unknown', thresholdNote(known, band)),
    severity,
    reason: choose(severity === 'low', undefined, 'changes often'),
  }
}

function usedByFactor(metrics: Metrics): Factor {
  const band = THRESHOLDS.blastRadius
  const count = metrics.blastRadius ?? 0
  const severity = severityOf(count, band)
  return {
    key: 'used-by',
    icon: Share2,
    title: `Used by ${count} ${plural(count, 'file')}`,
    detail: choose(severity === 'low', 'Few files depend on it', 'Most affected if it breaks'),
    note: thresholdNote(count, band),
    severity,
    reason: choose(severity === 'low', undefined, 'is used by much of the code'),
  }
}

function sizeFactor(changeSize: number | null): Factor {
  const band = THRESHOLDS.changeSize
  const lines = changeSize ?? 0
  const severity = severityOf(lines, band)
  return {
    key: 'size',
    icon: Ruler,
    title: choose(
      changeSize == null,
      'Lines changed unknown',
      `${lines} ${plural(lines, 'line')} changed`
    ),
    detail: 'Additions plus deletions',
    note: thresholdNote(lines, band),
    severity,
    reason: choose(severity === 'low', undefined, 'changes a lot of lines'),
  }
}

function testFactor(present: boolean | null): Factor {
  const base = { key: 'test', icon: FlaskConical, title: 'Has a test' }
  if (present == null) return { ...base, detail: 'Not checked', note: 'unknown', severity: 'low' }
  if (present)
    return { ...base, detail: 'A test file sits alongside it', note: 'yes', severity: 'fine' }
  return {
    ...base,
    detail: 'No test file alongside it',
    note: 'no',
    severity: 'medium',
  }
}

function coverageSeverity(percent: number): Severity {
  if (percent >= 80) return 'fine'
  if (percent >= 50) return 'medium'
  return 'high'
}

function coverageFactor(percent: number | null): Factor {
  const base = { key: 'coverage', icon: Percent, title: 'Patch coverage' }
  if (percent == null) {
    return { ...base, detail: 'CI did not report it', note: 'unknown', severity: 'low' }
  }
  return {
    ...base,
    detail: `${percent}% of the changed lines are covered`,
    note: `${percent}%`,
    severity: coverageSeverity(percent),
  }
}

function factorsOf(riskScore: RiskScore): Factor[] {
  const { metrics } = riskScore
  return [
    churnFactor(metrics.churn90d),
    usedByFactor(metrics),
    sizeFactor(metrics.changeSize),
    testFactor(metrics.testFilePresent),
    coverageFactor(metrics.patchCoverage),
  ]
}

const LEVEL_LABEL: Record<RiskScore['level'], string> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, fine: 3 }

/** One sentence naming the one or two worst factors that set the level; a missing test is listed but never named. */
function leadSentence(factors: Factor[]): string {
  const reasons = factors
    .filter((factor) => factor.reason != null)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 2)
    .map((factor) => factor.reason)
  if (reasons.length === 0) return 'because no single factor stands out'
  return `because it ${reasons.join(' and ')}`
}

function Importers({ riskScore, repoRoot }: { riskScore: RiskScore; repoRoot: string }) {
  const { topImporters, importerCount } = riskScore
  if (topImporters.length === 0) return null
  const hiddenCount = importerCount - topImporters.length
  return (
    <div className="ri-importers">
      <h3 className="ri-importers-heading">Importers ({importerCount})</h3>
      <div className="ri-importer-list">
        {topImporters.map((importer) => (
          <button
            type="button"
            key={importer}
            className="risk-importer-btn ri-importer"
            onClick={() => window.electronAPI.shell.openPath(`${repoRoot}/${importer}`)}
            title={importer}
          >
            {importer.split('/').pop()}
          </button>
        ))}
        {hiddenCount > 0 && <span className="ri-importer-more">+{hiddenCount}</span>}
      </div>
    </div>
  )
}

function FactorRow({ factor, children }: { factor: Factor; children?: React.ReactNode }) {
  const Icon = factor.icon
  return (
    <div className={`ri-factor ri-factor--${factor.severity}`}>
      <Icon className="ri-factor-icon" aria-hidden="true" />
      <div>
        <b>{factor.title}</b>
        <small>{factor.detail}</small>
        {children}
      </div>
      <span className="ri-factor-note">{factor.note}</span>
    </div>
  )
}

export function WhyThisFile({ file }: WhyThisFileProps) {
  const { riskScore, repoRoot } = file
  const factors = factorsOf(riskScore)
  return (
    <div className="ri-why">
      <h2 className="ri-lead">
        <span className={`ri-chip ri-chip--${riskScore.level}`}>
          {LEVEL_LABEL[riskScore.level]}
        </span>
        {leadSentence(factors)}
      </h2>
      <div className="ri-factors">
        {factors.map((factor) => (
          <FactorRow key={factor.key} factor={factor}>
            {factor.key === 'used-by' && <Importers riskScore={riskScore} repoRoot={repoRoot} />}
          </FactorRow>
        ))}
      </div>
      <p className="ri-foot-note">
        Levels come from fixed thresholds, the same ones the review list uses. They are not scored
        against the other files in this PR.
      </p>
    </div>
  )
}
