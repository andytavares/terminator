import React from 'react'
import { plural } from '@terminator/extension-sdk'
import type { ContributionsCalendar } from '../../schemas/contributions.schema'

const WEEKDAY_NAMES = [
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
  'Sundays',
]

interface TileSpec {
  label: string
  value: string | null
  sub: string | null
}

/** "Sep 2026" for a `YYYY-MM` month key. */
function monthName(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return new Date(year, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

function streakTile(label: string, days: number | null): TileSpec {
  const sub = label === 'Current streak' ? "Weekends don't break it" : null
  return { label, value: days === null ? null : `${days} ${plural(days, 'day')}`, sub }
}

function monthTile(calendar: ContributionsCalendar | null): TileSpec {
  const month = calendar?.mostActiveMonth ?? null
  if (!month) return { label: 'Most active month', value: null, sub: null }
  return {
    label: 'Most active month',
    value: monthName(month.month),
    sub: `${month.total} ${plural(month.total, 'contribution')}`,
  }
}

function weekdayTile(calendar: ContributionsCalendar | null): TileSpec {
  const day = calendar?.mostActiveWeekday ?? null
  if (!day) return { label: 'Most active day', value: null, sub: null }
  return {
    label: 'Most active day',
    value: WEEKDAY_NAMES[day.weekday - 1],
    sub: `${day.total} ${plural(day.total, 'contribution')}`,
  }
}

/** The four highlights under the heatmap: streaks, most active month and weekday. */
export function Highlights({
  calendar,
}: {
  calendar: ContributionsCalendar | null
}): React.JSX.Element {
  const tiles = [
    streakTile('Current streak', calendar?.currentStreak ?? null),
    streakTile('Longest streak', calendar?.longestStreak ?? null),
    monthTile(calendar),
    weekdayTile(calendar),
  ]
  return (
    <div className="ct-stats">
      {tiles.map((tile) => (
        <dl className="ct-stat" key={tile.label}>
          <dt>{tile.label}</dt>
          <dd>{tile.value ?? '—'}</dd>
          {tile.sub && <span className="ct-sub">{tile.sub}</span>}
        </dl>
      ))}
    </div>
  )
}
