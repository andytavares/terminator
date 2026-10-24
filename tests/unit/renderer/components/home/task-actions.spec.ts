import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskStore } from '../../../../../src/renderer/stores/task.store'
import { toggleFocus } from '../../../../../src/renderer/components/home/task-actions'
import { TaskCreateInputSchema, type Task } from '../../../../../src/shared/schemas/tasks.schema'
import type { WorkThread } from '../../../../../src/renderer/home/work-threads'

const lane = { repoRoot: '/repos/terminator', branch: 'tav-31' }

/** A store that refuses what main's schema refuses, and otherwise stores the task. */
function useSchemaCheckedStore(): void {
  useTaskStore.setState({
    tasks: [],
    create: async (input) => {
      if (!TaskCreateInputSchema.safeParse(input).success) return false
      const stored: Task = {
        id: '11111111-1111-4111-8111-111111111111',
        title: input.title,
        lanes: input.lanes,
        ticket: input.ticket ?? null,
        focus: false,
        doneAt: null,
        createdAt: '2026-10-24T09:00:00.000Z',
        archivedAt: null,
      }
      useTaskStore.setState({ tasks: [stored] })
      return true
    },
    update: async ({ id, focus }) => {
      useTaskStore.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, focus: focus ?? t.focus } : t)),
      }))
      return true
    },
  })
}

beforeEach(useSchemaCheckedStore)

describe('toggleFocus', () => {
  it('stores a thread whose title is longer than a task title may be, cut to fit', async () => {
    const title = 'Reproduce the staging 429s '.repeat(8)
    const thread = {
      key: '/repos/terminator#tav-31',
      taskId: null,
      title,
      focus: false,
      lanes: [lane],
    }
    await toggleFocus(thread as unknown as WorkThread)
    const [stored] = useTaskStore.getState().tasks
    expect(stored.focus).toBe(true)
    expect(title.startsWith(stored.title)).toBe(true)
    expect(stored.title.length).toBeLessThanOrEqual(120)
  })
})
