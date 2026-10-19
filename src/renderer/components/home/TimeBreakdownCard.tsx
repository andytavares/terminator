import React from 'react'
import { MetricCard } from '@terminator/extension-ui'
import {
  formatAge,
  formatNumber,
  type InsightsWindow,
  type TicketTime,
  type TimeBreakdown,
  type TimeSegment,
} from '../../home/insights'
import { EmptyCard, windowQualifier } from './InsightsCards'

// "Where did the time go?": one bar per merged ticket, split by who the time was waiting on.
// A segment nobody could measure is left out of the bar and the legend, never shown as zero.

const SEGMENT_LABEL: Record<TimeSegment, string> = {
  agent: 'Agent working',
  you: 'Waiting on you',
  review: 'Waiting for review',
  checks: 'Checks running',
}

const MINUTE_MS = 60_000

const segmentMinutesOf = (ticket: TicketTime, segment: TimeSegment): number =>
  ticket.minutes[segment] ?? 0

function describeTicket(ticket: TicketTime, measured: readonly TimeSegment[]): string {
  const parts = measured
    .filter((segment) => ticket.minutes[segment] !== undefined)
    .map(
      (segment) =>
        `${formatAge(segmentMinutesOf(ticket, segment) * MINUTE_MS)} ${SEGMENT_LABEL[segment]}`
    )
  return `${ticket.key}: ${parts.join(', ')}`
}

function TicketBar({ ticket, measured }: { ticket: TicketTime; measured: readonly TimeSegment[] }) {
  return (
    <div className="ins__tl">
      <span className="ins__tl-key">{ticket.key}</span>
      <span className="ins__bar-track" role="img" aria-label={describeTicket(ticket, measured)}>
        {measured.map((segment) => (
          <span
            key={segment}
            className={`ins__seg ins__seg--${segment}`}
            style={{ flexGrow: segmentMinutesOf(ticket, segment) }}
          />
        ))}
      </span>
      <span className="ins__tl-total">{formatNumber(ticket.totalDays)} days</span>
    </div>
  )
}

function Legend({ measured }: { measured: readonly TimeSegment[] }): JSX.Element {
  return (
    <ul className="ins__legend" aria-label="Legend">
      {measured.map((segment) => (
        <li key={segment}>
          <span className={`ins__swatch ins__seg--${segment}`} aria-hidden="true" />
          {SEGMENT_LABEL[segment]}
        </li>
      ))}
    </ul>
  )
}

interface TimeBreakdownCardProps {
  chosen: InsightsWindow
  breakdown: TimeBreakdown
}

export function TimeBreakdownCard({ chosen, breakdown }: TimeBreakdownCardProps): JSX.Element {
  const question = 'Where did the time go?'
  const qualifier = `· tickets merged ${windowQualifier(chosen)}, start to merge`
  const { tickets, measured } = breakdown
  if (tickets.length === 0 || measured.length === 0) {
    return (
      <EmptyCard question={question} qualifier={qualifier} reason="Not enough merged work yet" />
    )
  }
  return (
    <MetricCard question={question} qualifier={qualifier} value="">
      {tickets.map((ticket) => (
        <TicketBar key={ticket.key} ticket={ticket} measured={measured} />
      ))}
      <Legend measured={measured} />
    </MetricCard>
  )
}
