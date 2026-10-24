import React from 'react'
import { HOME_MEASURES } from '@terminator/extension-sdk/plain'
import { ArrowUpRight } from 'lucide-react'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useHomeView } from './home-view'
import { useWeekMeasures, type WeekMeasures } from './useWeekMeasures'
import { ArchivedTasks } from './ArchivedTasks'

/** "This week: 4 shipped · agents waited a median of 5 min on you"; null when neither is known. */
export function weekSentence(shipped: number | null, week: WeekMeasures | null): string | null {
  const parts = [
    ...(shipped === null ? [] : [`${shipped} shipped`]),
    ...(week && week.waits > 0
      ? [`agents waited a median of ${Math.round(week.waitMedianMinutes)} min on you`]
      : []),
  ]
  return parts.length === 0 ? null : `This week: ${parts.join(' · ')}`
}

/** The week in one line, the way to Insights, and the archived tasks. */
export function HomeFooter(): JSX.Element {
  const shipped = useHomeFeedStore((s) => s.measures.find((m) => m.id === HOME_MEASURES.shipped))
  const week = useWeekMeasures()
  const show = useHomeView((s) => s.show)
  const sentence = weekSentence(shipped?.value ?? null, week)
  return (
    <footer className="home-foot">
      {sentence && <span>{sentence}</span>}
      <button type="button" className="desk-link" onClick={() => show('insights')}>
        Open Insights <ArrowUpRight aria-hidden="true" />
      </button>
      <span className="home-foot__spacer" />
      <ArchivedTasks />
    </footer>
  )
}
