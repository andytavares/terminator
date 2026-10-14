import React from 'react'
import type { SystemMetrics } from '@shared/types/index'
import './MetricsBar.css'

function formatBytesPerSec(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB/s`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB/s`
  return `${Math.round(n)} B/s`
}

function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1)
}

interface Props {
  system: SystemMetrics | null
}

export function MetricsBar({ system }: Props): JSX.Element {
  if (!system) return <MetricsPlaceholder />
  const cpuPct = Math.round(system.cpuPercent)
  const memPct = (system.memUsedBytes / system.memTotalBytes) * 100
  return (
    <div className="metrics-bar">
      <BarMetric label="CPU" percent={cpuPct} colour={cpuColour(cpuPct)}>
        {cpuPct}%
      </BarMetric>
      <BarMetric label="MEM" percent={memPct} colour="var(--tm-accent)">
        {formatGiB(system.memUsedBytes)} / {formatGiB(system.memTotalBytes)} GB
      </BarMetric>
      <div className="metrics-bar__item">
        <span className="metrics-bar__label">NET</span>
        <span className="metrics-bar__value">
          ↓ {formatBytesPerSec(system.netInBytesPerSec)} ↑{' '}
          {formatBytesPerSec(system.netOutBytesPerSec)}
        </span>
      </div>
    </div>
  )
}

/** Amber from 70%, red from 90%. */
function cpuColour(percent: number): string {
  if (percent >= 90) return '#e03131'
  return percent >= 70 ? '#f08c00' : 'var(--tm-accent)'
}

/** Each metric's label over a skeleton, until the first sample arrives. */
function MetricsPlaceholder(): JSX.Element {
  return (
    <div className="metrics-bar">
      {['CPU', 'MEM', 'NET'].map((label) => (
        <div key={label} className="metrics-bar__item">
          <span className="metrics-bar__label">{label}</span>
          <span className="skeleton skeleton--metrics" />
        </div>
      ))}
    </div>
  )
}

interface BarMetricProps {
  label: string
  percent: number
  colour: string
  /** The reading beside the bar. */
  children: React.ReactNode
}

function BarMetric({ label, percent, colour, children }: BarMetricProps): JSX.Element {
  return (
    <div className="metrics-bar__item">
      <span className="metrics-bar__label">{label}</span>
      <div className="metrics-bar__bar-track">
        <div
          className="metrics-bar__bar-fill"
          style={{ width: `${percent}%`, background: colour }}
        />
      </div>
      <span className="metrics-bar__value">{children}</span>
    </div>
  )
}
