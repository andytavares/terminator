import { create } from 'zustand'

/** Whether the Plan today sheet is open; P and the plan strip's Plan button open it. */
export const usePlanSheet = create<{ open: boolean; show: () => void; hide: () => void }>(
  (set) => ({ open: false, show: () => set({ open: true }), hide: () => set({ open: false }) })
)
