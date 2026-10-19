import { create } from 'zustand'
import type { InsightsWindow } from '../../home/insights'

interface InsightsWindowState {
  chosen: InsightsWindow
  choose: (chosen: InsightsWindow) => void
}

/** The time window Insights reads, chosen in Home's header. */
export const useInsightsWindow = create<InsightsWindowState>((set) => ({
  chosen: 'week',
  choose: (chosen) => set({ chosen }),
}))
