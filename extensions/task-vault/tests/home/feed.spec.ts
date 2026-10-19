import { describe, it, expect } from 'vitest'
import { buildHomeFeed, type HomeFeedInput } from '../../src/home/feed'
import type { IndexedTask } from '../../src/vault/types'

function vaultTask(overrides: Partial<IndexedTask> & { id: string }): IndexedTask {
  return {
    filePath: '',
    line: 0,
    status: 'open',
    text: `Task ${overrides.id}`,
    terminatorLinks: [],
    ...overrides,
  }
}

const TODAY = '2026-10-18'

function input(overrides: Partial<HomeFeedInput> = {}): HomeFeedInput {
  return {
    tasks: [],
    today: '2026-10-18',
    reviewDay: 3,
    weekday: 0,
    reviewStarted: false,
    ...overrides,
  }
}

describe('Home asks for due tasks', () => {
  it('asks "Task due" for an open task due today, with its text, project and two actions', () => {
    const dueToday = vaultTask({ id: 't1', text: 'Send invoice', dueDate: TODAY, project: 'Acme' })
    const { asks } = buildHomeFeed(input({ tasks: [dueToday] }))

    expect(asks).toEqual([
      expect.objectContaining({
        id: 'task:t1',
        kind: 'task',
        title: 'Task due',
        detail: 'Send invoice',
        facts: ['Acme'],
        workKey: null,
        actions: [
          { id: 'done', label: 'Mark done', primary: true },
          { id: 'open', label: 'Open' },
        ],
        open: { command: 'task-vault:open', args: { taskId: 't1' } },
      }),
    ])
  })

  it('asks "Task overdue" for an earlier due date and falls back to the area for the fact', () => {
    const { asks } = buildHomeFeed(
      input({ tasks: [vaultTask({ id: 't2', dueDate: '2026-10-10', area: 'Home' })] })
    )

    expect(asks[0]).toMatchObject({ title: 'Task overdue', facts: ['Home'] })
  })
})

describe('Home asks for tasks that are not waiting', () => {
  it('leaves out done, cancelled and migrated tasks, and tasks due later or never', () => {
    const { asks } = buildHomeFeed(
      input({
        tasks: [
          vaultTask({ id: 'a', status: 'done', dueDate: '2026-10-18' }),
          vaultTask({ id: 'b', status: 'cancelled', dueDate: '2026-10-18' }),
          vaultTask({ id: 'c', status: 'migrated', dueDate: '2026-10-18' }),
          vaultTask({ id: 'd', dueDate: '2026-10-19' }),
          vaultTask({ id: 'e' }),
        ],
      })
    )

    expect(asks).toEqual([])
  })
})

describe('Home ask for the weekly review', () => {
  it('asks only on the review day', () => {
    expect(buildHomeFeed(input({ weekday: 2 })).asks).toEqual([])
    expect(buildHomeFeed(input({ weekday: 3 })).asks).toEqual([
      expect.objectContaining({
        id: 'weekly-review',
        kind: 'task',
        title: 'Weekly review is ready',
        actions: [{ id: 'start-review', label: 'Start', primary: true }],
        open: { command: 'task-vault:open', args: { view: 'review' } },
      }),
    ])
  })

  it('is gone once the review has been started', () => {
    expect(buildHomeFeed(input({ weekday: 3, reviewStarted: true })).asks).toEqual([])
  })
})

describe('Home focus candidates', () => {
  it('mirror the tasks on Today, with done following the status', () => {
    const { focus } = buildHomeFeed(
      input({
        tasks: [
          vaultTask({ id: 'x', text: 'Write spec', todaySince: '2026-10-18', project: 'Acme' }),
          vaultTask({ id: 'y', status: 'done', todaySince: '2026-10-17' }),
          vaultTask({ id: 'z' }),
        ],
      })
    )

    expect(focus).toEqual([
      { id: 'task:x', title: 'Write spec', detail: 'Acme', workKey: null, done: false },
      { id: 'task:y', title: 'Task y', detail: undefined, workKey: null, done: true },
    ])
  })
})
