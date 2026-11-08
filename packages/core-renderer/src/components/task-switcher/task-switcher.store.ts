import { create } from 'zustand'

/** Whether the ⌘J task switcher is showing. */
export const useTaskSwitcher = create<{
  open: boolean
  show: () => void
  hide: () => void
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
