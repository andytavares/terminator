import React from 'react'
import { HOME_MEASURES } from '@terminator/extension-sdk/plain'
import { ArrowUpRight } from 'lucide-react'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useHomeView } from './home-view'
import { useWeekMeasures, type WeekMeasures } from './useWeekMeasures'
import type { HomeMeasure } from '../../../shared/schemas/home-feed.schema'

interface KpiProps {
  label: string
  value: string
  note: string
  tone?: 'up' | 'down'
}

function WeekKpi(props: KpiProps): JSX.Element {
  const { label, value, note, tone } = props
  return (
    <div className="desk-kpi">
      <small>{label}</small>
      <b>{value}</b>
      <i className={tone ? `desk-kpi__note desk-kpi__note--${tone}` : 'desk-kpi__note'}>{note}</i>
    </div>
  )
}

/** "6 min", or "3 h 10" from an hour on. */
function minutesLabel(minutes: number): string {
  const whole = Math.round(minutes)
  if (whole < 60) return `${whole} min`
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')}`
}

function mergedKpi(measure: HomeMeasure): KpiProps {
  const difference = measure.value - (measure.previous ?? measure.value)
  const note =
    difference === 0
      ? 'same as last week'
      : `${Math.abs(difference)} ${difference > 0 ? 'more' : 'fewer'}`
  return {
    label: 'Merged',
    value: String(measure.value),
    note: measure.previous === undefined ? '' : note,
    tone: difference === 0 ? undefined : difference > 0 ? 'up' : 'down',
  }
}

function waitKpi(measure: HomeMeasure): KpiProps {
  return { label: 'Your review wait', value: minutesLabel(measure.value), note: 'median' }
}

function attentionKpis(week: WeekMeasures): KpiProps[] {
  const slower = week.waitMedianMinutes > week.previousWaitMedianMinutes
  return [
    {
      label: 'Agents waited on you',
      value: week.waits === 0 ? '—' : minutesLabel(week.waitMedianMinutes),
      note:
        week.waits === 0 ? 'no waits' : `median, was ${Math.round(week.previousWaitMedianMinutes)}`,
      tone: week.waits > 0 && slower ? 'down' : undefined,
    },
    {
      label: 'Agent hours',
      value: String(Math.round(week.agentHours)),
      note: `across ${week.sessions} sessions`,
    },
  ]
}

const HEAT_CELLS = 36
const HEAT_MAX = 4

function HeatStrip({ days }: { days: readonly number[] }): JSX.Element {
  return (
    <div className="desk-heat" aria-hidden="true">
      {days.slice(-HEAT_CELLS).map((level, index) => (
        <i
          key={index}
          className={`desk-heat__${Math.min(HEAT_MAX, Math.max(0, Math.round(level)))}`}
        />
      ))}
    </div>
  )
}

/** Only the tiles whose numbers exist: a measure nobody published leaves no tile. */
function weekKpis(measures: readonly HomeMeasure[], week: WeekMeasures | null): KpiProps[] {
  const merged = measures.find((m) => m.id === HOME_MEASURES.shipped)
  const wait = measures.find((m) => m.id === HOME_MEASURES.reviewWait)
  return [
    ...(merged ? [mergedKpi(merged)] : []),
    ...(wait ? [waitKpi(wait)] : []),
    ...(week ? attentionKpis(week) : []),
  ]
}

/** The week against the one before it: four numbers, a heat strip, and the way to Insights. */
export function WeekCard(): JSX.Element {
  const measures = useHomeFeedStore((s) => s.measures)
  const show = useHomeView((s) => s.show)
  const week = useWeekMeasures()
  const heat = measures.find((m) => m.id === HOME_MEASURES.contributionsDays)
  const kpis = weekKpis(measures, week)
  return (
    <div className="desk-card">
      <div className="desk-sec-h desk-sec-h--tight">
        <h5>This week</h5>
        <span>vs last week</span>
      </div>
      <div className="desk-kpis">
        {kpis.map((kpi) => (
          <WeekKpi key={kpi.label} {...kpi} />
        ))}
      </div>
      {heat && <HeatStrip days={heat.series} />}
      <div className="desk-card__foot">
        <button type="button" className="desk-link" onClick={() => show('insights')}>
          Open Insights <ArrowUpRight aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
