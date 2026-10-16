import React from 'react'
import type { ContributionsDay } from '../../schemas/contributions.schema'

/** The weekday column heads: the Mon/Wed/Fri rows carry words, per the design. */
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short' })

/** The 53-week calendar: month labels above, Mon/Wed/Fri at the left, future days not drawn. */
export function Heatmap(props: { weeks: ContributionsDay[][] | null; total: number }): JSX.Element {
  return (
    <div>
      <div className="ct-map-head">
        <h2>{props.weeks ? `${props.total} contributions in the last year` : '—'}</h2>
        <span className="ct-sp" />
        <Legend />
      </div>
      <HeatmapGrid weeks={props.weeks ?? []} total={props.total} />
    </div>
  )
}

function HeatmapGrid(props: { weeks: ContributionsDay[][]; total: number }): JSX.Element {
  return (
    <div
      className="ct-heatmap"
      role="img"
      aria-label={`Contribution heatmap of the last 53 weeks, ${props.total} contributions`}
    >
      <div className="ct-grid">
        <WeekdayColumn />
        <div className="ct-year">
          <MonthRow weeks={props.weeks} />
          <div className="ct-grid">
            {props.weeks.map((week, index) => (
              <WeekColumn key={week[0]?.date ?? index} week={week} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Legend(): JSX.Element {
  return (
    <span className="ct-legend">
      Less
      {[0, 1, 2, 3, 4].map((level) => (
        <i key={level} style={{ background: `var(--tm-heat-${level})` }} />
      ))}
      More
    </span>
  )
}

function WeekdayColumn(): JSX.Element {
  return (
    <div className="ct-weekdays" aria-hidden="true">
      {WEEKDAY_LABELS.map((label, row) => (
        <span key={row}>{label}</span>
      ))}
    </div>
  )
}

/** One month name above the first column that starts in it; 12px is a cell plus its gap. */
function MonthRow({ weeks }: { weeks: ContributionsDay[][] }): JSX.Element {
  return (
    <div className="ct-months" aria-hidden="true">
      {monthLabels(weeks).map((month) => (
        <span key={month.column} style={{ left: month.column * 12 }}>
          {month.label}
        </span>
      ))}
    </div>
  )
}

/** A week column; the first row's month joins the label row above when it changes. */
function WeekColumn(props: { week: ContributionsDay[] }): JSX.Element {
  return (
    <div className="ct-week">
      {props.week.map((day) => (
        <div
          key={day.date}
          className="ct-day"
          style={chooseStyle(day)}
          title={day.future ? undefined : dayTitle(day)}
        />
      ))}
    </div>
  )
}

/** Future days keep their cell so the grid holds its shape, but draw nothing. */
function chooseStyle(day: ContributionsDay): React.CSSProperties {
  if (day.future) return { visibility: 'hidden' }
  return { background: `var(--tm-heat-${day.level})` }
}

/** "3 contributions on Thu, Oct 16, 2026". */
function dayTitle(day: ContributionsDay): string {
  const date = new Date(`${day.date}T00:00:00`)
  return `${day.total} ${day.total === 1 ? 'contribution' : 'contributions'} on ${DAY_FORMAT.format(date)}`
}

/** The month a week starts in, above the first column of each run of that month. */
function monthLabels(weeks: ContributionsDay[][]): { label: string; column: number }[] {
  const labels: { label: string; column: number }[] = []
  weeks.forEach((week, column) => {
    const first = week[0]
    if (!first) return
    const month = first.date.slice(5, 7)
    const previous = column > 0 ? weeks[column - 1][0]?.date.slice(5, 7) : null
    if (month !== previous) {
      labels.push({ label: MONTH_FORMAT.format(new Date(`${first.date}T00:00:00`)), column })
    }
  })
  return labels
}
