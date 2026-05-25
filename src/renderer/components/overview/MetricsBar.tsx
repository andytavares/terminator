import React from 'react'
import type { SystemMetrics } from '../../../../shared/types/index'
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
  if (!system) {
    return (
      <div className="metrics-bar">
        <div className="metrics-bar__item">
          <span className="metrics-bar__label">CPU</span>
          <span className="skeleton skeleton--metrics" />
        </div>
        <div className="metrics-bar__item">
          <span className="metrics-bar__label">MEM</span>
          <span className="skeleton skeleton--metrics" />
        </div>
        <div className="metrics-bar__item">
          <span className="metrics-bar__label">NET</span>
          <span className="skeleton skeleton--metrics" />
        </div>
      </div>
    )
  }

  const cpuPct = Math.round(system.cpuPercent)
  const cpuColor = cpuPct >= 90 ? '#e03131' : cpuPct >= 70 ? '#f08c00' : 'var(--accent)'

  return (
    <div className="metrics-bar">
      <div className="metrics-bar__item">
        <span className="metrics-bar__label">CPU</span>
        <div className="metrics-bar__bar-track">
          <div
            className="metrics-bar__bar-fill"
            style={{ width: `${cpuPct}%`, background: cpuColor }}
          />
        </div>
        <span className="metrics-bar__value">{cpuPct}%</span>
      </div>

      <div className="metrics-bar__item">
        <span className="metrics-bar__label">MEM</span>
        <div className="metrics-bar__bar-track">
          <div
            className="metrics-bar__bar-fill"
            style={{
              width: `${(system.memUsedBytes / system.memTotalBytes) * 100}%`,
              background: 'var(--accent)',
            }}
          />
        </div>
        <span className="metrics-bar__value">
          {formatGiB(system.memUsedBytes)} / {formatGiB(system.memTotalBytes)} GB
        </span>
      </div>

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
