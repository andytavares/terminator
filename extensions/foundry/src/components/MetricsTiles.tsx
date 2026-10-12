import React from 'react'
import { SegmentedControl } from '@terminator/extension-ui'
import type { FactoryMetrics } from '../factory/metrics.js'
import { formatDuration } from '../factory/format.js'

// The nine factory numbers, shared between the Ledger's Factory view and the
// Factory site's status wall. A null in `FactoryMetrics` means "nothing to
// measure yet" and reads as "—", never as zero.

function fmtCount(value: number | null): string {
  return value === null ? '—' : String(Math.round(value * 10) / 10)
}

function fmtDuration(value: number | null): string {
  return value === null ? '—' : formatDuration(value)
}

function fmtShare(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

export function metricsTiles(metrics: FactoryMetrics): readonly [string, string][] {
  return [
    ['Shipped', String(metrics.shipped)],
    ['Median lead time', fmtDuration(metrics.medianLeadTimeMs)],
    ['Median your time', fmtDuration(metrics.medianYourTimeMs)],
    ['First-pass yield', fmtShare(metrics.firstPassYield)],
    ['Reworks / order', fmtCount(metrics.reworksPerOrder)],
    ['CI rounds / order', fmtCount(metrics.ciRoundsPerOrder)],
    ['Sessions / order', fmtCount(metrics.sessionsPerOrder)],
    ['Forge follow-ups', String(metrics.forgeFollowUps)],
    ['Forge decisions struck', fmtShare(metrics.forgeDecisionsStruckShare)],
  ]
}

export interface MetricsTilesProps {
  readonly metrics: FactoryMetrics
}

export function MetricsTiles({ metrics }: MetricsTilesProps): JSX.Element {
  return (
    <div className="fdry-metrics-tiles">
      {metricsTiles(metrics).map(([label, value]) => (
        <div key={label} className="fdry-metrics-tile">
          <span className="fdry-metrics-tile__value">{value}</span>
          <span className="fdry-metrics-tile__label">{label}</span>
        </div>
      ))}
    </div>
  )
}

export interface WindowToggleProps {
  readonly value: 'all' | '30d'
  readonly onChange: (value: 'all' | '30d') => void
}

const WINDOW_OPTIONS = [
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
] as const

/** The 30 days / all time switch, shared wherever a `FactoryMetrics` window is chosen. */
export function WindowToggle({ value, onChange }: WindowToggleProps): JSX.Element {
  return (
    <SegmentedControl
      label="Time window"
      size="sm"
      className="fdry-window-toggle"
      options={WINDOW_OPTIONS}
      value={value}
      onChange={onChange}
    />
  )
}
