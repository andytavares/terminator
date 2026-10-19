import React from 'react'
import { HOME_MEASURES } from '@terminator/extension-sdk/plain'
import { Clock, GitPullRequest, ListTodo } from 'lucide-react'
import { Button, MetricCard } from '@terminator/extension-ui'
import type { AgentUsage } from '../../../shared/agents/agent-usage'
import type { AttentionMeasures } from '../../../shared/home/attention-measures'
import type { HomeAsk, HomeMeasure, Sourced } from '../../../shared/schemas/home-feed.schema'
import { useExtensionRegistry } from '../../extensions/registry'
import {
  formatAge,
  formatNumber,
  formatTokens,
  measureReading,
  type InsightsWindow,
} from '../../home/insights'
import { openAsk, runAskAction } from './desk-actions'
import { windowQualifier } from './InsightsCards'

// The lower half of Insights: where the time went, how agent time was spent, when the work
// shipped (an extension's own view), and the things worth looking back at.

interface KpiProps {
  label: string
  value: string
  detail: string
}

function Kpi({ label, value, detail }: KpiProps): JSX.Element {
  return (
    <div className="ins__kpi">
      <small>{label}</small>
      <b>{value}</b>
      <i>{detail}</i>
    </div>
  )
}

const dash = (value: number | undefined, format: (n: number) => string): string =>
  value === undefined ? '–' : format(value)

interface AgentTimeProps {
  attention: AttentionMeasures | null
  usage: AgentUsage | null
  measures: readonly HomeMeasure[]
  chosen: InsightsWindow
}

/** The orders an extension shipped, worded by the measure it published; nothing when none did. */
function OrdersShipped({ measures, chosen }: Pick<AgentTimeProps, 'measures' | 'chosen'>) {
  const published = measures.find((m) => m.id === HOME_MEASURES.ordersShipped)
  const shipped = measureReading(measures, HOME_MEASURES.ordersShipped, chosen)
  const firstPass = measureReading(measures, HOME_MEASURES.firstPass, chosen)
  if (published === undefined || shipped === null) return null
  const detail = firstPass === null ? published.detail : `first-pass ${firstPass.value}%`
  return <Kpi label={published.question} value={String(shipped.value)} detail={detail ?? ''} />
}

function UsageLine({ usage }: { usage: AgentUsage | null }): JSX.Element {
  if (usage === null) return <div className="ins__note">Tokens and cost could not be read.</div>
  const { tokens, costUsd, costIsPartial } = usage.totals
  const note = costIsPartial ? 'estimate, partial: some models have no price' : 'estimate'
  return (
    <div className="ins__note">
      Tokens <b>{formatTokens(tokens.input + tokens.output)}</b> · Estimated cost{' '}
      <b>${costUsd.toFixed(2)}</b> <span>({note})</span>
    </div>
  )
}

function AgentKpis(props: AgentTimeProps): JSX.Element {
  const { attention, usage } = props
  const sessions = usage?.sessions.length
  const ratio = (r: number): string => `${Math.round(r * 100)}%`
  return (
    <div className="ins__kpis">
      <Kpi
        label="Agent hours"
        value={dash(attention?.agentHours, formatNumber)}
        detail={sessions === undefined ? 'agents working' : `${sessions} sessions`}
      />
      <Kpi
        label="Running at once"
        value={dash(attention?.runningAtOnceMedian, formatNumber)}
        detail="median while you work"
      />
      <Kpi
        label="Finished without help"
        value={dash(attention?.finishedWithoutHelpRatio, ratio)}
        detail="no ask before done"
      />
      <OrdersShipped measures={props.measures} chosen={props.chosen} />
    </div>
  )
}

export function AgentTimeCard(props: AgentTimeProps): JSX.Element {
  return (
    <MetricCard
      question="How am I spending agent time?"
      qualifier={`· ${windowQualifier(props.chosen)}`}
      value=""
    >
      <AgentKpis {...props} />
      <UsageLine usage={props.usage} />
    </MetricCard>
  )
}

/** The section each extension drew for Insights, under the question it answers. */
export function ShipSections(): JSX.Element | null {
  const sections = useExtensionRegistry((s) => s.insightsSections)
  if (sections.size === 0) return null
  return (
    <>
      {[...sections.values()].map((section) => (
        <MetricCard
          key={section.id}
          question="When do I ship?"
          qualifier={`· ${section.label.toLowerCase()}`}
          value=""
        >
          <section aria-label={section.label} className="ins__section">
            <section.component />
          </section>
        </MetricCard>
      ))}
    </>
  )
}

interface LookingBackProps {
  asks: readonly Sourced<HomeAsk>[]
  longestWaitMinutes: number
  oldestReview: { ask: Sourced<HomeAsk>; ageMs: number } | null
}

interface LookBackRowProps {
  icon: JSX.Element
  title: string
  detail: string
  action?: { label: string; primary: boolean; run: () => void }
}

function LookBackRow(props: LookBackRowProps): JSX.Element {
  const { icon, title, detail, action } = props
  return (
    <div className="ins__lr">
      {icon}
      <span>
        {title} <small>· {detail}</small>
      </span>
      {action ? (
        <Button size="sm" variant={action.primary ? 'secondary' : 'ghost'} onClick={action.run}>
          {action.label}
        </Button>
      ) : (
        <span />
      )}
    </div>
  )
}

/** The weekly review a task extension offers: a task ask whose primary action is Start review. */
function weeklyReviewAsk(asks: readonly Sourced<HomeAsk>[]): Sourced<HomeAsk> | null {
  return (
    asks.find((a) => a.kind === 'task' && a.actions.some((x) => x.id === 'start-review')) ?? null
  )
}

function WeeklyReviewRow({ review }: { review: Sourced<HomeAsk> }): JSX.Element {
  return (
    <LookBackRow
      icon={<ListTodo aria-hidden="true" />}
      title={review.title}
      detail={review.detail}
      action={{
        label: 'Start',
        primary: true,
        run: () => void runAskAction(review, 'start-review'),
      }}
    />
  )
}

function OldestReviewRow({ oldest }: { oldest: NonNullable<LookingBackProps['oldestReview']> }) {
  return (
    <LookBackRow
      icon={<GitPullRequest aria-hidden="true" />}
      title="Oldest review you owe"
      detail={`${oldest.ask.detail} · ${formatAge(oldest.ageMs)}`}
      action={{ label: 'Open', primary: false, run: () => void openAsk(oldest.ask) }}
    />
  )
}

export function LookingBackCard(props: LookingBackProps): JSX.Element {
  const { asks, longestWaitMinutes, oldestReview } = props
  const review = weeklyReviewAsk(asks)
  const nothing = !review && longestWaitMinutes <= 0 && !oldestReview
  return (
    <MetricCard question="Looking back" value="">
      {review && <WeeklyReviewRow review={review} />}
      {longestWaitMinutes > 0 && (
        <LookBackRow
          icon={<Clock aria-hidden="true" />}
          title="Longest wait on you"
          detail={`${Math.round(longestWaitMinutes)} min`}
        />
      )}
      {oldestReview && <OldestReviewRow oldest={oldestReview} />}
      {nothing && <div className="ins__note">Nothing to look back on yet.</div>}
    </MetricCard>
  )
}
