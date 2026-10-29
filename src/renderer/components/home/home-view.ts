import { create } from 'zustand'
import { recordUse } from '../../usage/record'

export type HomeViewName = 'desk' | 'insights'

/** Which of Home's two views shows; the Today rail's "Open Insights" link switches it. */
export const useHomeView = create<{ view: HomeViewName; show: (view: HomeViewName) => void }>(
  (set, get) => ({
    view: 'desk',
    show: (view) => {
      if (get().view !== view) recordUse(`core.home.view.${view}`)
      set({ view })
    },
  })
)
