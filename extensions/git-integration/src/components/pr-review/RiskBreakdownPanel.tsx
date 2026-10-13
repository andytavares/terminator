import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'
import type { RiskScore } from '../../schemas/pr-review.schema'
import { choose } from '../text'

const IMPORTERS_INITIAL = 5

interface Props {
  filePath: string
  riskScore: RiskScore
  repoRoot: string
}

type Metrics = RiskScore['metrics']

interface MetricRow {
  label: string
  value: string | number | null
  max: number
}

function coverageValue(metrics: Metrics): string | null {
  if (metrics.patchCoverage == null) return null
  return `${metrics.patchCoverage}%`
}

function metricRows(metrics: Metrics): MetricRow[] {
  return [
    { label: 'Change size', value: metrics.changeSize, max: 500 },
    { label: 'Churn 90d', value: metrics.churn90d, max: 100 },
    { label: 'Blast radius', value: metrics.blastRadius, max: 200 },
    { label: 'Complexity delta', value: metrics.complexityDelta, max: 20 },
    { label: 'Patch coverage', value: coverageValue(metrics), max: 100 },
  ]
}

function MetricBar({ row }: { row: MetricRow }) {
  if (row.value == null) return <span className="risk-metric-unknown">?</span>
  const width = Math.min(100, (Number(row.value) / row.max) * 100)
  return (
    <>
      <div className="risk-metric-bar-track">
        <div className="risk-metric-bar-fill" style={{ width: `${width}%` }} />
      </div>
      <span className="risk-metric-value">{row.value}</span>
    </>
  )
}

function testFileText(present: boolean | null | undefined): string {
  if (present == null) return '?'
  return choose(present, 'present', 'missing')
}

function MetricBars({ metrics }: { metrics: Metrics }) {
  const verdict = choose(metrics.testFilePresent, 'pass', 'fail')
  return (
    <div className="risk-metric-bars" aria-label="Metric contributions">
      {metricRows(metrics).map((row) => (
        <div key={row.label} className="risk-metric-row">
          <span className="risk-metric-label">{row.label}</span>
          <MetricBar row={row} />
        </div>
      ))}
      <div className="risk-metric-row">
        <span className="risk-metric-label">Test file</span>
        <span className={`risk-metric-boolean risk-metric-boolean--${verdict}`}>
          {testFileText(metrics.testFilePresent)}
        </span>
      </div>
    </div>
  )
}

function ImporterList(props: { importers: string[]; repoRoot: string }) {
  return (
    <ul className="risk-importers-list">
      {props.importers.map((imp) => (
        <li key={imp} className="risk-importer-path">
          <button
            className="risk-importer-btn"
            onClick={() => window.electronAPI.shell.openPath(`${props.repoRoot}/${imp}`)}
            title={imp}
          >
            {imp.split('/').pop()}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Importers(props: { riskScore: RiskScore; repoRoot: string }) {
  const { topImporters, importerCount } = props.riskScore
  const [expanded, setExpanded] = useState(false)
  const visible = choose(expanded, topImporters, topImporters.slice(0, IMPORTERS_INITIAL))
  const hiddenCount = topImporters.length - IMPORTERS_INITIAL
  return (
    <div className="risk-importers">
      <h3 className="risk-importers-heading">Importers ({importerCount})</h3>
      <ImporterList importers={visible} repoRoot={props.repoRoot} />
      {hiddenCount > 0 && !expanded && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          Show {hiddenCount} more…
        </Button>
      )}
      {expanded && hiddenCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
          Collapse
        </Button>
      )}
    </div>
  )
}

export function RiskBreakdownPanel({ filePath, riskScore, repoRoot }: Props) {
  const { level, composite } = riskScore
  return (
    <aside
      className={`risk-breakdown-panel risk-breakdown-panel--${level}`}
      aria-label="Risk breakdown"
    >
      <h2 className="risk-breakdown-heading">
        Why this file is{' '}
        <span className={`risk-level-badge risk-level-badge--${level}`}>{level.toUpperCase()}</span>{' '}
        risk
      </h2>
      <p className="risk-dominant-driver">{riskScore.dominantDriver}</p>
      {composite != null && (
        <div className="risk-composite">
          <span className="risk-composite-score">{composite}</span>
          <span className="risk-composite-max"> / 100</span>
        </div>
      )}
      <MetricBars metrics={riskScore.metrics} />
      {riskScore.topImporters.length > 0 && <Importers riskScore={riskScore} repoRoot={repoRoot} />}
      <p className="risk-breakdown-file">{filePath}</p>
    </aside>
  )
}
