import { create } from 'zustand'
import { recordUse } from '../../usage/record'
import type { InsightsWindow } from '../../home/insights'

interface InsightsWindowState {
  chosen: InsightsWindow
  choose: (chosen: InsightsWindow) => void
}

/** The time window Insights reads, chosen in Home's header. */
export const useInsightsWindow = create<InsightsWindowState>((set, get) => ({
  chosen: 'week',
  choose: (chosen) => {
    if (get().chosen !== chosen) recordUse('core.home.insights-window')
    set({ chosen })
  },
}))
