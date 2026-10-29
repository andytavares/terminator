import React from 'react'
import { MetricCard } from '@terminator/extension-ui'
import {
  activeCardValue,
  formatActive,
  formatDay,
  isCurrent,
  periodWords,
  type Period,
  type StatedRow,
} from './usage-model'

interface UsageCardsProps {
  rows: readonly StatedRow[]
  period: Period
  start: string | null
}

type CardProps = UsageCardsProps

const countOf = (rows: readonly StatedRow[], state: StatedRow['state']): number =>
  rows.filter((entry) => entry.state === state).length

/** "Core 38 of 54 · Extensions 23 of 51" */
function usedBySource(current: readonly StatedRow[]): string {
  const core = current.filter((entry) => entry.row.source === 'core')
  const extensions = current.filter((entry) => entry.row.source !== 'core')
  const part = (name: string, rows: readonly StatedRow[]): string =>
    `${name} ${countOf(rows, 'used')} of ${rows.length}`
  return [part('Core', core), part('Extensions', extensions)].join(' · ')
}

/** "Home 38 h 10 m · Foundry 9 h", the features that held the most active time. */
function topActive(rows: readonly StatedRow[]): string {
  return rows
    .filter(({ row }) => row.activeMs > 0)
    .sort((a, b) => b.row.activeMs - a.row.activeMs)
    .slice(0, 3)
    .map(({ row }) => `${row.label} ${formatActive(row.activeMs)}`)
    .join(' · ')
}

function FeaturesUsedCard({ rows, period }: CardProps): JSX.Element {
  const current = rows.filter(isCurrent)
  return (
    <MetricCard
      question="Features used"
      qualifier={periodWords(period)}
      value={
        <>
          {countOf(rows, 'used')}
          <span className="usage__of"> of {current.length}</span>
        </>
      }
      sub={usedBySource(current)}
    />
  )
}

function ActiveTimeCard({ rows, period }: CardProps): JSX.Element {
  const active = activeCardValue(rows.reduce((sum, { row }) => sum + row.activeMs, 0))
  return (
    <MetricCard
      question="Active time"
      qualifier={periodWords(period)}
      value={active.value}
      unit={active.unit}
      sub={topActive(rows)}
    />
  )
}

export function UsageCards(props: UsageCardsProps): JSX.Element {
  const { rows, period, start } = props
  const fresh = countOf(rows, 'new')
  return (
    <div className="usage__cards">
      <FeaturesUsedCard {...props} />
      <MetricCard
        question="Not used"
        qualifier={periodWords(period)}
        value={countOf(rows, 'not-used-in-period')}
        sub={start ? `Used before ${formatDay(start)}, none since` : undefined}
      />
      <MetricCard
        question="Never used"
        qualifier="since added"
        value={countOf(rows, 'never-used')}
        sub={fresh > 0 ? `${fresh} more are new this period` : undefined}
      />
      <ActiveTimeCard {...props} />
    </div>
  )
}
