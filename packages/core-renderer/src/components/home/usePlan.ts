import { useMemo } from 'react'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useFocusStore } from '../../home/focus-store'
import {
  carriedOver,
  focusDone as isFocusDone,
  localDateKey,
  type FocusItem,
} from '../../home/focus'
import {
  carriedOverRows,
  estimatedReviewMinutes,
  planSentence,
  yesterdayKey,
  type PlanRow,
} from '../../home/plan-the-day'
import { useDeskModel } from './useDeskModel'
import { useWorkThreads } from './useWorkThreads'

export interface Plan {
  sentence: string
  carried: PlanRow[]
  today: FocusItem[]
  reviewMinutes: number
}

export function usePlan(now: number): Plan {
  const { asks } = useDeskModel()
  const { allThreads } = useWorkThreads()
  const candidates = useHomeFeedStore((s) => s.focus)
  const days = useFocusStore((s) => s.days)
  return useMemo(() => {
    const today = days[localDateKey(now)] ?? []
    const yesterday = days[yesterdayKey(now)] ?? []
    const finished = yesterday.filter((item) => isFocusDone(item, allThreads, candidates))
    const left = carriedOver(yesterday).filter((item) => !finished.includes(item))
    return {
      sentence: planSentence({
        focusTotal: yesterday.length,
        focusDone: finished.length,
        waiting: {
          questions: asks.filter((a) => a.kind === 'answer').length,
          agents: asks.filter((a) => a.kind === 'finished').length,
          reviews: asks.filter((a) => a.kind === 'review').length,
        },
      }),
      carried: carriedOverRows(left, candidates, today),
      today,
      reviewMinutes: estimatedReviewMinutes(asks),
    }
  }, [asks, candidates, days, now, allThreads])
}
