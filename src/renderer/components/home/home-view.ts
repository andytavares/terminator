import { create } from 'zustand'

export type HomeViewName = 'desk' | 'insights'

/** Which of Home's two views shows; the Today rail's "Open Insights" link switches it. */
export const useHomeView = create<{ view: HomeViewName; show: (view: HomeViewName) => void }>(
  (set) => ({ view: 'desk', show: (view) => set({ view }) })
)
