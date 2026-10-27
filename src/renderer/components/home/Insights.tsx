import React, { useMemo } from 'react'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useNow } from '../session/useNow'
import { useDismissalsStore } from '../../home/dismissals'
import { isHidden } from '../../home/desk-order'
import {
  oldestReview,
  startToMerge,
  timeBreakdown,
  windowRange,
  type TicketTimeInput,
  type InsightsWindow,
} from '../../home/insights'
import { FirstPassCard, ShippedCard, StartToMergeCard, WaitCard } from './InsightsCards'
import { AgentTimeCard, LookingBackCard, ShipSections } from './InsightsLower'
import { TimeBreakdownCard } from './TimeBreakdownCard'
import { useInsightsData, type InsightsData } from './useInsightsData'
import { useInsightsWindow } from './insights-window'
import './Insights.css'

function useFeedForInsights() {
  const asks = useHomeFeedStore((s) => s.asks)
  const facets = useHomeFeedStore((s) => s.facets)
  const measures = useHomeFeedStore((s) => s.measures)
  return { asks, facets, measures }
}

type Feed = ReturnType<typeof useFeedForInsights>

interface RowProps {
  chosen: InsightsWindow
  data: InsightsData
  feed: Feed
}

/** The pull requests that closed and the log's intervals, over the chosen window, for the ticket cards. */
function useTicketTimeInput({ chosen, data, feed }: RowProps): TicketTimeInput {
  const now = useNow()
  const { facets } = feed
  const { intervals } = data
  return useMemo(
    () => ({ facets, intervals, range: windowRange(chosen, now) }),
    [facets, intervals, chosen, now]
  )
}

function QuestionsRow(props: RowProps): JSX.Element {
  const { chosen, data, feed } = props
  const spread = startToMerge(useTicketTimeInput(props))
  return (
    <div className="ins__row ins__row--four">
      <ShippedCard measures={feed.measures} chosen={chosen} />
      <StartToMergeCard spread={spread} />
      <WaitCard attention={data.attention} before={data.attentionBefore} />
      <FirstPassCard measures={feed.measures} chosen={chosen} />
    </div>
  )
}

function TimeRow(props: RowProps): JSX.Element {
  const { chosen, data, feed } = props
  const { attention, usage } = data
  const breakdown = timeBreakdown(useTicketTimeInput(props))
  return (
    <div className="ins__row ins__row--two">
      <TimeBreakdownCard chosen={chosen} breakdown={breakdown} />
      <AgentTimeCard {...{ attention, usage, chosen }} measures={feed.measures} />
    </div>
  )
}

function LookingBackRow({ data, feed }: Pick<RowProps, 'data' | 'feed'>): JSX.Element {
  const now = useNow()
  const entries = useDismissalsStore((state) => state.entries)
  const open = feed.asks.filter((ask) => !isHidden(ask, entries, now))
  const oldest = oldestReview(open)
  return (
    <div className="ins__row ins__row--two">
      <ShipSections />
      <LookingBackCard
        longestWaitMinutes={data.attention?.longestWait ?? 0}
        oldestReview={oldest && { ask: oldest, ageMs: now - Date.parse(oldest.since) }}
      />
    </div>
  )
}

/** The second view of Home: each card is titled by the question it answers. */
export function Insights(): JSX.Element {
  const chosen = useInsightsWindow((s) => s.chosen)
  const data = useInsightsData(chosen)
  const feed = useFeedForInsights()
  return (
    <section className="ins" aria-label="Insights">
      <QuestionsRow {...{ chosen, data, feed }} />
      <TimeRow {...{ chosen, data, feed }} />
      <LookingBackRow data={data} feed={feed} />
    </section>
  )
}
