import React, { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, SegmentedControl } from '@terminator/extension-ui'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useNow } from '../session/useNow'
import {
  INSIGHTS_WINDOWS,
  oldestReview,
  startToMerge,
  windowRange,
  type InsightsWindow,
} from '../../home/insights'
import { FirstPassCard, ShippedCard, StartToMergeCard, WaitCard } from './InsightsCards'
import { AgentTimeCard, LookingBackCard, ShipSections, TimeBreakdownCard } from './InsightsLower'
import { useInsightsData, type InsightsData } from './useInsightsData'
import './Insights.css'

interface WindowProps {
  chosen: InsightsWindow
  onChange: (chosen: InsightsWindow) => void
}

function InsightsBar({ chosen, onChange }: WindowProps): JSX.Element {
  return (
    <div className="ins__bar">
      <SegmentedControl
        label="Time window"
        size="sm"
        options={INSIGHTS_WINDOWS}
        value={chosen}
        onChange={onChange}
      />
      <Button variant="ghost" size="sm" disabled title="Filtering by repo is not available yet">
        All repos <ChevronDown aria-hidden="true" />
      </Button>
    </div>
  )
}

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

/** Ticket start to merge, from the sessions' records and the pull requests that closed. */
function useStartToMerge({ chosen, feed }: Pick<RowProps, 'chosen' | 'feed'>) {
  const records = useSessionRecordsStore((s) => s.records)
  const now = useNow()
  return useMemo(
    () => startToMerge([...records.values()], feed.facets, windowRange(chosen, now)),
    [records, feed.facets, chosen, now]
  )
}

function QuestionsRow(props: RowProps): JSX.Element {
  const { chosen, data, feed } = props
  const spread = useStartToMerge(props)
  return (
    <div className="ins__row ins__row--four">
      <ShippedCard measures={feed.measures} chosen={chosen} />
      <StartToMergeCard spread={spread} />
      <WaitCard attention={data.attention} before={data.attentionBefore} />
      <FirstPassCard measures={feed.measures} chosen={chosen} />
    </div>
  )
}

function TimeRow({ chosen, data, feed }: RowProps): JSX.Element {
  const { attention, usage } = data
  return (
    <div className="ins__row ins__row--two">
      <TimeBreakdownCard chosen={chosen} />
      <AgentTimeCard {...{ attention, usage, chosen }} measures={feed.measures} />
    </div>
  )
}

function LookingBackRow({ data, feed }: Pick<RowProps, 'data' | 'feed'>): JSX.Element {
  const now = useNow()
  const oldest = oldestReview(feed.asks)
  return (
    <div className="ins__row ins__row--two">
      <ShipSections />
      <LookingBackCard
        asks={feed.asks}
        longestWaitMinutes={data.attention?.longestWait ?? 0}
        oldestReview={oldest && { ask: oldest, ageMs: now - Date.parse(oldest.since) }}
      />
    </div>
  )
}

/** The second view of Home: each card is titled by the question it answers. */
export function Insights(): JSX.Element {
  const [chosen, setChosen] = useState<InsightsWindow>('week')
  const data = useInsightsData(chosen)
  const feed = useFeedForInsights()
  return (
    <section className="ins" aria-label="Insights">
      <InsightsBar chosen={chosen} onChange={setChosen} />
      <QuestionsRow {...{ chosen, data, feed }} />
      <TimeRow {...{ chosen, data, feed }} />
      <LookingBackRow data={data} feed={feed} />
    </section>
  )
}
