import React from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { choose } from '../text'
import type { ContributionCounts } from '../../schemas/contributions.schema'

/** Which kind each tile reads, so the same lookup serves the period and the previous one. */
const TILES: ReadonlyArray<{ label: string; kind: keyof ContributionCounts }> = [
  { label: 'Contributions', kind: 'total' },
  { label: 'PRs opened', kind: 'opened' },
  { label: 'PRs merged', kind: 'merged' },
  { label: 'Reviews', kind: 'reviewed' },
]

/** How much more (or less) of `kind` the period holds than the one before; null before data. */
function changeOf(
  counts: { period: ContributionCounts | null; previous: ContributionCounts | null },
  kind: keyof ContributionCounts
): number | null {
  const { period, previous } = counts
  return period && previous ? period[kind] - previous[kind] : null
}

/** The four period stats, each with the change against the previous period. */
export function PeriodStats(props: {
  period: ContributionCounts | null
  previous: ContributionCounts | null
}): React.JSX.Element {
  return (
    <div className="ct-stats">
      {TILES.map((tile) => (
        <StatTile
          key={tile.label}
          label={tile.label}
          value={props.period?.[tile.kind] ?? null}
          delta={changeOf(props, tile.kind)}
        />
      ))}
    </div>
  )
}

function StatTile(props: {
  label: string
  value: number | null
  delta: number | null
}): React.JSX.Element {
  return (
    <dl className="ct-stat">
      <dt>{props.label}</dt>
      <dd>{props.value ?? '—'}</dd>
      <Delta delta={props.delta} />
    </dl>
  )
}

/** "+58 vs prev period", green up when higher, red down when lower, flat when equal. */
function Delta({ delta }: { delta: number | null }): React.JSX.Element | null {
  if (delta === null) return null
  if (delta === 0) return <span className="ct-delta">Same as prev period</span>
  const up = delta > 0
  return (
    <span className={`ct-delta ${choose(up, 'ct-delta--up', 'ct-delta--down')}`}>
      {choose(up, <ArrowUpRight aria-hidden="true" />, <ArrowDownRight aria-hidden="true" />)}
      {`${up ? '+' : '−'}${Math.abs(delta)} vs prev period`}
    </span>
  )
}
