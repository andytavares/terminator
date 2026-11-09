import { vi } from 'vitest'
import { useTaskStore } from '../../core-renderer/src/stores/task.store'
import type { TaskLane } from '../../core-shared/src/schemas/tasks.schema'

type Main = typeof import('../../core-main/src/tasks/task-store')

// The renderer's task IPC answered by main's own task store, so a test reads what was stored.
// The caller mocks `electron` so the store writes under a temp userData.
async function answer<T>(run: () => Promise<T>) {
  try {
    return { data: await run() }
  } catch (error) {
    return { error: (error as { code: string }).code, message: String(error) }
  }
}

type LaneInput = { id: string; lane: TaskLane }

export async function wireMainTaskStore(): Promise<Main> {
  vi.resetModules()
  const main: Main = await import('../../core-main/src/tasks/task-store')
  vi.stubGlobal('electronAPI', {
    ...window.electronAPI,
    tasks: {
      create: (input: never) => answer(() => main.createTask(input)),
      update: (input: never) => answer(() => main.updateTask(input)),
      addLane: ({ id, lane }: LaneInput) => answer(() => main.addLane(id, lane)),
      removeLane: ({ id, lane }: LaneInput) => answer(() => main.removeLane(id, lane)),
      delete: ({ id }: { id: string }) => answer(() => main.deleteTask(id)),
      merge: ({ from, into }: { from: string; into: string }) =>
        answer(() => main.mergeTasks(from, into)),
    },
  })
  useTaskStore.setState({ tasks: [] })
  main.onTaskChange((tasks) => useTaskStore.setState({ tasks }))
  return main
}
