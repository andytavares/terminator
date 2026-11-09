import React, { useEffect, useState } from 'react'
import { StatusDot, type StatusTone } from '@terminator/extension-ui'
import { plural } from '@terminator/extension-sdk/plain'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useFocusStore } from '../../home/focus-store'
import { focusDone, localDateKey } from '../../home/focus'
import type { DeskCounts } from '../../home/desk-summary'
import { useDeskFilter, type DeskCount } from './desk-filter'
import type { DeskState } from './useDeskModel'

export interface SummaryLineProps {
  desk: Pick<DeskState, 'counts' | 'allThreads' | 'now'>
}

interface CountSpec {
  filter: DeskCount
  count: keyof DeskCounts
  tone: StatusTone
  pulse?: boolean
  words: (n: number) => string
}

const COUNTS: CountSpec[] = [
  { filter: 'your-move', count: 'yourMove', tone: 'waiting', words: () => 'your move' },
  {
    filter: 'agents',
    count: 'agentsWorking',
    tone: 'working',
    pulse: true,
    words: (n) => plural(n, 'agent working', 'agents working'),
  },
  { filter: 'others', count: 'waitingOnOthers', tone: 'muted', words: () => 'waiting on others' },
  {
    filter: 'failing',
    count: 'failingChecks',
    tone: 'bad',
    words: (n) => plural(n, 'failing check', 'failing checks'),
  },
]

/** Minutes agents sat waiting on the operator since midnight; null until the main process answers. */
function useWaitedOnYouToday(now: number): number | null {
  const [minutes, setMinutes] = useState<number | null>(null)
  useEffect(() => {
    const midnight = new Date(now).setHours(0, 0, 0, 0)
    void window.electronAPI?.attention
      ?.measures({ window: { from: midnight, to: now } })
      .then((result) => setMinutes(result.data.waitedOnYouToday))
      .catch(() => setMinutes(null))
  }, [now])
  return minutes
}

/** One line of counts, each a filter when pressed, and today's focus and waiting at the right. */
export function SummaryLine(props: SummaryLineProps): React.JSX.Element {
  const { desk } = props
  const filter = useDeskFilter((s) => s.count)
  const setCount = useDeskFilter((s) => s.setCount)
  return (
    <div className="strip" role="group" aria-label="Summary">
      {COUNTS.filter((spec) => desk.counts[spec.count] > 0).map((spec) => (
        <button
          key={spec.filter}
          type="button"
          className="strip__count"
          aria-pressed={filter === spec.filter}
          onClick={() => setCount(filter === spec.filter ? null : spec.filter)}
        >
          <StatusDot tone={spec.tone} pulse={spec.pulse} />
          <b>{desk.counts[spec.count]}</b> {spec.words(desk.counts[spec.count])}
        </button>
      ))}
      <span className="strip__spacer" />
      <FocusProgress desk={desk} />
      <WaitedOnYou now={desk.now} />
    </div>
  )
}

function FocusProgress({ desk }: Pick<SummaryLineProps, 'desk'>): React.JSX.Element | null {
  const days = useFocusStore((s) => s.days)
  const candidates = useHomeFeedStore((s) => s.focus)
  const items = days[localDateKey(desk.now)] ?? []
  if (items.length === 0) return null
  const done = items.filter((item) => focusDone(item, desk.allThreads, candidates)).length
  return (
    <span className="strip__fact">
      Focus{' '}
      <b>
        {done} of {items.length}
      </b>{' '}
      done
    </span>
  )
}

function WaitedOnYou({ now }: { now: number }): React.JSX.Element | null {
  const minutes = useWaitedOnYouToday(now)
  if (minutes === null || Math.round(minutes) === 0) return null
  return (
    <span className="strip__fact">
      Agents waited on you <b>{Math.round(minutes)} min</b> today
    </span>
  )
}
