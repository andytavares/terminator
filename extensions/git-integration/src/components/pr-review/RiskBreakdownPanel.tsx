import React from 'react'
import type { RiskScore } from '../../../../../src/shared/schemas/pr-review.schema'

interface Props {
  filePath: string
  riskScore: RiskScore
}

export function RiskBreakdownPanel({ filePath, riskScore }: Props) {
  const { level, composite, metrics, dominantDriver, topImporters, importerCount } = riskScore

  const metricRows: Array<{ label: string; value: string | number | null; max: number }> = [
    { label: 'Change size',       value: metrics.changeSize,      max: 500 },
    { label: 'Churn 90d',         value: metrics.churn90d,        max: 100 },
    { label: 'Blast radius',      value: metrics.blastRadius,     max: 200 },
    { label: 'Complexity delta',  value: metrics.complexityDelta, max: 20 },
    { label: 'Patch coverage',    value: metrics.patchCoverage != null ? `${metrics.patchCoverage}%` : null, max: 100 },
  ]

  return (
    <aside className={`risk-breakdown-panel risk-breakdown-panel--${level}`} aria-label="Risk breakdown">
      <h2 className="risk-breakdown-heading">
        Why this file is <span className={`risk-level-badge risk-level-badge--${level}`}>{level.toUpperCase()}</span> risk
      </h2>

      <p className="risk-dominant-driver">{dominantDriver}</p>

      {composite != null && (
        <div className="risk-composite">
          <span className="risk-composite-score">{composite}</span>
          <span className="risk-composite-max"> / 100</span>
        </div>
      )}

      <div className="risk-metric-bars" aria-label="Metric contributions">
        {metricRows.map(row => (
          <div key={row.label} className="risk-metric-row">
            <span className="risk-metric-label">{row.label}</span>
            {row.value == null ? (
              <span className="risk-metric-unknown">?</span>
            ) : (
              <>
                <div className="risk-metric-bar-track">
                  <div
                    className="risk-metric-bar-fill"
                    style={{ width: `${Math.min(100, (Number(row.value) / row.max) * 100)}%` }}
                  />
                </div>
                <span className="risk-metric-value">{row.value}</span>
              </>
            )}
          </div>
        ))}

        <div className="risk-metric-row">
          <span className="risk-metric-label">Test file</span>
          <span className={`risk-metric-boolean risk-metric-boolean--${metrics.testFilePresent ? 'pass' : 'fail'}`}>
            {metrics.testFilePresent == null ? '?' : metrics.testFilePresent ? 'present' : 'missing'}
          </span>
        </div>
      </div>

      {topImporters.length > 0 && (
        <div className="risk-importers">
          <h3 className="risk-importers-heading">
            Importers (top {topImporters.length} of {importerCount})
          </h3>
          <ul className="risk-importers-list">
            {topImporters.map(imp => (
              <li key={imp} className="risk-importer-path">{imp}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="risk-breakdown-file">{filePath}</p>
    </aside>
  )
}
