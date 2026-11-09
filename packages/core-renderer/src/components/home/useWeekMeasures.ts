import { useEffect, useState } from 'react'
import { useNow } from '../session/useNow'

export interface WeekMeasures {
  waitMedianMinutes: number
  waits: number
  previousWaitMedianMinutes: number
  agentHours: number
  sessions: number
}

const HOUR_MS = 3_600_000
const WEEK_MS = 7 * 24 * HOUR_MS

async function readWeek(now: number): Promise<WeekMeasures | null> {
  const api = window.electronAPI
  const [thisWeek, lastWeek, usage] = await Promise.all([
    api.attention.measures({ window: { from: now - WEEK_MS, to: now } }),
    api.attention.measures({ window: { from: now - 2 * WEEK_MS, to: now - WEEK_MS } }),
    api.agentUsage.get({
      from: new Date(now - WEEK_MS).toISOString(),
      to: new Date(now).toISOString(),
    }),
  ])
  if (!('data' in usage)) return null
  return {
    waitMedianMinutes: thisWeek.data.waitsOnYou.medianMinutes,
    waits: thisWeek.data.waitsOnYou.count,
    previousWaitMedianMinutes: lastWeek.data.waitsOnYou.medianMinutes,
    agentHours: thisWeek.data.agentHours,
    sessions: usage.data.sessions.length,
  }
}

/** How much the agents needed you this week and last, and how long they ran; null while unread or unreadable. */
export function useWeekMeasures(): WeekMeasures | null {
  const [measures, setMeasures] = useState<WeekMeasures | null>(null)
  const hour = Math.floor(useNow(HOUR_MS) / HOUR_MS)

  useEffect(() => {
    let current = true
    readWeek(hour * HOUR_MS)
      .then((week) => current && setMeasures(week))
      .catch(() => current && setMeasures(null))
    return () => {
      current = false
    }
  }, [hour])

  return measures
}
