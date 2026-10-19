import React from 'react'
import { HOME_MEASURES } from '@terminator/extension-sdk'
import { MetricCard, Sparkline } from '@terminator/extension-ui'
import type { SparklineTone } from '@terminator/extension-ui'
import type { HomeMeasure } from '../../../shared/schemas/home-feed.schema'
import type { AttentionMeasures } from '../../../shared/home/attention-measures'
import {
  compareCount,
  formatNumber,
  measureReading,
  type DurationSpread,
  type InsightsWindow,
} from '../../home/insights'

// The four questions across the top of Insights. A card with nothing honest to say still asks its
// question and says why it has no number; it never shows one it made up.

const WINDOW_QUALIFIER: Record<InsightsWindow, string> = {
  week: 'this week',
  '30d': 'in the last 30 days',
  quarter: 'this quarter',
  year: 'this year',
}

export const windowQualifier = (chosen: InsightsWindow): string => WINDOW_QUALIFIER[chosen]

interface EmptyCardProps {
  question: string
  qualifier: string
  reason: string
}

export function EmptyCard({ question, qualifier, reason }: EmptyCardProps): JSX.Element {
  return <MetricCard question={question} qualifier={qualifier} value="–" sub={reason} />
}

const SUB_TONE = { up: 'ins__up', down: 'ins__down', same: undefined } as const

interface ShippedCardProps {
  measures: readonly HomeMeasure[]
  chosen: InsightsWindow
}

export function ShippedCard({ measures, chosen }: ShippedCardProps): JSX.Element {
  const question = 'How much shipped?'
  const reading = measureReading(measures, HOME_MEASURES.shipped, chosen)
  if (reading === null) {
    return (
      <EmptyCard
        question={question}
        qualifier="· merged pull requests"
        reason="Not measured for this range"
      />
    )
  }
  const comparison = compareCount(reading, chosen)
  return (
    <MetricCard
      question={question}
      qualifier="· merged pull requests"
      value={reading.value}
      sub={comparison && <span className={SUB_TONE[comparison.tone]}>{comparison.text}</span>}
    >
      <Sparkline values={reading.series} tone="accent" label="Merged pull requests per week" />
    </MetricCard>
  )
}

export function StartToMergeCard({ spread }: { spread: DurationSpread | null }): JSX.Element {
  const question = 'How long from start to merge?'
  if (spread === null) {
    return (
      <EmptyCard question={question} qualifier="· per ticket" reason="Not enough merged work yet" />
    )
  }
  return (
    <MetricCard
      question={question}
      qualifier="· per ticket"
      value={formatNumber(spread.medianDays)}
      unit=" days median"
      sub={`middle half: ${formatNumber(spread.lowDays)} to ${formatNumber(spread.highDays)} days`}
    />
  )
}

interface WaitCardProps {
  attention: AttentionMeasures | null
  before: AttentionMeasures | null
}

function waitSub({ attention, before }: WaitCardProps & { attention: AttentionMeasures }) {
  const { count, medianMinutes, over30 } = attention.waitsOnYou
  const earlier =
    before && before.waitsOnYou.count > 0 ? Math.round(before.waitsOnYou.medianMinutes) : null
  const change = earlier === null ? null : Math.round(medianMinutes) > earlier ? 'up' : 'down'
  const waited = `${count} asks, ${over30} waited over 30 min`
  return (
    <>
      {change && (
        <span className={change === 'up' ? 'ins__down' : 'ins__up'}>
          {change} from {earlier}
        </span>
      )}
      {change && ' · '}
      {waited}
    </>
  )
}

export function WaitCard({ attention, before }: WaitCardProps): JSX.Element {
  const question = 'How long do agents wait on me?'
  if (attention === null || attention.waitsOnYou.count === 0) {
    return (
      <EmptyCard
        question={question}
        qualifier="· per ask"
        reason="No agent has waited on you in this range"
      />
    )
  }
  const tone: SparklineTone = 'warning'
  return (
    <MetricCard
      question={question}
      qualifier="· per ask"
      value={Math.round(attention.waitsOnYou.medianMinutes)}
      unit=" min median"
      sub={waitSub({ attention, before })}
    >
      <Sparkline
        values={attention.perDay.map((day) => day.waitMinutes)}
        tone={tone}
        label="Minutes agents waited on you, per day"
      />
    </MetricCard>
  )
}

/** The first-pass rate an extension published; no card when none did. */
export function FirstPassCard({ measures, chosen }: ShippedCardProps): JSX.Element | null {
  const measure = measures.find((m) => m.id === HOME_MEASURES.firstPass)
  if (measure === undefined) {
    const reason = 'Nothing measures this yet'
    return <EmptyCard question="How often does it pass first time?" qualifier="" reason={reason} />
  }
  const qualifier = `· ${windowQualifier(chosen)}`
  const reading = measureReading(measures, HOME_MEASURES.firstPass, chosen)
  if (reading === null) {
    return (
      <EmptyCard
        question={measure.question}
        qualifier={qualifier}
        reason="Not measured for this range"
      />
    )
  }
  return (
    <MetricCard
      question={measure.question}
      qualifier={qualifier}
      value={reading.value}
      unit="%"
      sub={measure.detail}
    />
  )
}
