import { vi } from 'vitest'
import { useTaskStore } from '../../src/renderer/stores/task.store'
import type { TaskLane } from '../../src/shared/schemas/tasks.schema'

type Main = typeof import('../../src/main/tasks/task-store')

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
  const main: Main = await import('../../src/main/tasks/task-store')
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
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
    },
  })
  useTaskStore.setState({ tasks: [] })
  main.onTaskChange((tasks) => useTaskStore.setState({ tasks }))
  return main
}
