import { create, type StoreApi } from 'zustand'
import type {
  Task,
  TaskLane,
  TaskUpdateInput,
  TaskCreateInput,
} from '../../shared/schemas/tasks.schema'

// The renderer's mirror of the main process's tasks. Main sends the full list
// on every change; tasks are few, so there is no per-task patching.

interface TaskState {
  tasks: Task[]
  load: () => Promise<void>
  subscribe: () => () => void
  /** Each write resolves false when it was refused, leaving the mirror as it was. */
  create: (input: TaskCreateInput) => Promise<boolean>
  update: (input: TaskUpdateInput) => Promise<boolean>
  addLane: (id: string, lane: TaskLane) => Promise<boolean>
  removeLane: (id: string, lane: TaskLane) => Promise<boolean>
  archive: (id: string, archived: boolean) => Promise<boolean>
  /** Moves every lane of `from` into `into`; `from` is gone afterwards. */
  merge: (from: string, into: string) => Promise<boolean>
}

type WriteResult = { data: Task } | { error: string; message: string }
type SetTasks = StoreApi<TaskState>['setState']

function api(): Partial<Window['electronAPI']['tasks']> {
  return window.electronAPI?.tasks ?? {}
}

/** Mirrors a write main accepted: the written task replaces its entry. */
async function write(set: SetTasks, call: Promise<WriteResult> | undefined): Promise<boolean> {
  const result = await call
  if (result === undefined || 'error' in result) return false
  const written = result.data
  set((state) => ({
    tasks: state.tasks.some((t) => t.id === written.id)
      ? state.tasks.map((t) => (t.id === written.id ? written : t))
      : [...state.tasks, written],
  }))
  return true
}

async function load(set: SetTasks): Promise<void> {
  try {
    const result = await api().list?.()
    if (result !== undefined) set({ tasks: result.data })
  } catch {
    // Keep the last known tasks rather than blanking Home.
  }
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  load: () => load(set),
  subscribe: () => {
    const on = api().onChanged
    if (typeof on !== 'function') return () => {}
    return on((tasks) => set({ tasks }))
  },
  create: (input) => write(set, api().create?.(input)),
  update: (input) => write(set, api().update?.(input)),
  addLane: (id, lane) => write(set, api().addLane?.({ id, lane })),
  removeLane: (id, lane) => write(set, api().removeLane?.({ id, lane })),
  archive: (id, archived) => write(set, api().archive?.({ id, archived })),
  merge: async (from, into) => {
    const merged = await write(set, api().merge?.({ from, into }))
    if (merged) set((state) => ({ tasks: state.tasks.filter((t) => t.id !== from) }))
    return merged
  },
}))
