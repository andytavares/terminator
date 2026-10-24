import { create } from 'zustand'
import type { TaskLane } from '../../../shared/schemas/tasks.schema'

/** The lane the Add to task picker is open for; null while it is closed. */
export const useAddToTaskStore = create<{
  lane: TaskLane | null
  open: (lane: TaskLane) => void
  close: () => void
}>((set) => ({
  lane: null,
  open: (lane) => set({ lane }),
  close: () => set({ lane: null }),
}))

/** Opens the picker for one lane: a sidebar branch, a terminal tab, an Overview tile or a Home row. */
export function openAddToTask(lane: { repoRoot: string; branch: string }): void {
  useAddToTaskStore.getState().open({ repoRoot: lane.repoRoot, branch: lane.branch })
}
