import React from 'react'
import './desk.css'

export type SparklineTone = 'accent' | 'info' | 'warning' | 'good'

export interface SparklineProps {
  /** Oldest first. Drawn to one scale: the lowest value sits at the bottom, the highest at the top. */
  values: readonly number[]
  tone?: SparklineTone
  size?: 'md' | 'sm'
  /** Says what the line shows, for assistive technology. Without it the chart is decoration. */
  label?: string
}

const WIDTH = 200
const HEIGHT = { md: 46, sm: 22 }
const PADDING = { md: 10, sm: 4 }
const ENDPOINT_INSET = 2
const TONE_COLOR: Record<SparklineTone, string> = {
  accent: 'var(--tm-accent-text)',
  info: 'var(--tm-syntax-literal)',
  warning: 'var(--tm-warning)',
  good: 'var(--tm-success)',
}

/** The point of each value: spread across the width, scaled between the padded top and bottom. */
export function sparklinePoints(
  values: readonly number[],
  size: 'md' | 'sm'
): { x: number; y: number }[] {
  const low = Math.min(...values)
  const range = Math.max(...values) - low
  const height = HEIGHT[size]
  const usable = height - 2 * PADDING[size]
  return values.map((value, index) => ({
    x: values.length > 1 ? (index / (values.length - 1)) * WIDTH : WIDTH,
    y: range === 0 ? height / 2 : PADDING[size] + (1 - (value - low) / range) * usable,
  }))
}

export function Sparkline({
  values,
  tone = 'accent',
  size = 'md',
  label,
}: SparklineProps): JSX.Element | null {
  if (values.length === 0) return null
  const points = sparklinePoints(values, size)
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
    .join(' ')
  const area = `${line} L${WIDTH} ${HEIGHT[size]} L${points[0].x} ${HEIGHT[size]}Z`
  const color = TONE_COLOR[tone]
  const last = points[points.length - 1]
  return (
    <svg
      className="tmui-sparkline"
      style={{ height: HEIGHT[size] }}
      viewBox={`0 0 ${WIDTH} ${HEIGHT[size]}`}
      preserveAspectRatio="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={area} fill={color} fillOpacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} />
      <circle cx={last.x - ENDPOINT_INSET} cy={last.y} r={2.6} fill={color} data-endpoint="" />
    </svg>
  )
}
