import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddToTaskDialog } from '../../../../../src/renderer/components/tasks/AddToTaskDialog'
import { openAddToTask } from '../../../../../src/renderer/components/tasks/add-to-task'
import { useTaskStore } from '../../../../../src/renderer/stores/task.store'
import { useWorkspaceStore } from '../../../../../src/renderer/stores/workspace.store'
import { installElectronApi } from '../../../../support/electron-api'
import { task } from '../../home/fixtures'
import type { Task, TaskLane } from '../../../../../src/shared/schemas/tasks.schema'
import type { Project, Workspace } from '../../../../../src/shared/types/index'

const repo = (id: string, name: string): Workspace => ({
  id,
  name,
  folderPath: `/repos/${name}`,
  color: '#fff',
  tags: [],
  createdAt: '',
  updatedAt: '',
})
const card = (workspaceId: string, branch: string): Project => ({
  id: `${workspaceId}-${branch}`,
  workspaceId,
  name: branch,
  gitBranch: branch,
  isWorktree: true,
  createdAt: '',
  updatedAt: '',
})

const RATE_LIMITS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BILLING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const THIS_LANE: TaskLane = { repoRoot: '/repos/api-gateway', branch: 'rate-limits' }

function seedWorld(tasks: Task[]): void {
  useWorkspaceStore.setState({
    workspaces: [repo('ws-1', 'terminator'), repo('ws-2', 'api-gateway'), repo('ws-3', 'web')],
    projectsByWorkspaceId: new Map([
      ['ws-1', [card('ws-1', 'rate-limits')]],
      ['ws-2', [card('ws-2', 'rate-limits')]],
      ['ws-3', [card('ws-3', 'rate-limits'), card('ws-3', 'billing')]],
    ]),
  })
  const change = (id: string, patch: (t: Task) => Task) =>
    useTaskStore.setState((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? patch(t) : t)) }))
  useTaskStore.setState({
    tasks,
    addLane: vi.fn(async (id: string, lane: TaskLane) => {
      change(id, (t) => ({ ...t, lanes: [...t.lanes, lane] }))
      return true
    }),
    create: vi.fn(async (input) => {
      useTaskStore.setState((s) => ({
        tasks: [...s.tasks, task({ ...input, id: crypto.randomUUID(), ticket: null })],
      }))
      return true
    }),
  })
}

const OPEN_TASKS = [
  task({ id: RATE_LIMITS, title: 'Rate limits across services', lanes: [] }),
  task({
    id: BILLING,
    title: 'Billing copy',
    lanes: [{ repoRoot: '/repos/web', branch: 'billing' }],
  }),
  task({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Shipped work', doneAt: 'now' }),
  task({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Old idea', archivedAt: 'now' }),
]

beforeEach(() => {
  vi.clearAllMocks()
  installElectronApi({})
  seedWorld(OPEN_TASKS)
  render(<AddToTaskDialog />)
  openAddToTask(THIS_LANE)
})

const lanesOf = (title: string) =>
  useTaskStore.getState().tasks.find((t) => t.title === title)?.lanes
const suggestion = () => screen.getByRole('checkbox', { name: /Add them too/ })

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('Add to task — which tasks it lists', () => {
  it('lists open tasks only, not finished or archived ones', () => {
    expect(screen.getByRole('button', { name: /Rate limits across services/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Billing copy/ })).toBeTruthy()
    expect(screen.queryByText('Shipped work')).toBeNull()
    expect(screen.queryByText('Old idea')).toBeNull()
  })

  it('filters as you type', () => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a task' }), {
      target: { value: 'bill' },
    })
    expect(screen.queryByRole('button', { name: /Rate limits across services/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Billing copy/ })).toBeTruthy()
  })

  it('marks the task that already holds the lane and does not offer to add it again', async () => {
    useTaskStore.setState({
      tasks: [task({ id: RATE_LIMITS, title: 'Rate limits across services', lanes: [THIS_LANE] })],
    })
    const row = await screen.findByRole('button', { name: /Rate limits across services/ })
    expect(row.textContent).toMatch(/Already in this task/)
    expect((row as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Add to task — the same-name suggestion', () => {
  it('offers the other repos’ branches of that name without adding them', async () => {
    expect(screen.getByText(/Suggested: 2 other branches named/).textContent).toContain(
      'rate-limits'
    )
    expect(suggestion().getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /Billing copy/ }))
    await waitFor(() => expect(lanesOf('Billing copy')).toHaveLength(2))
    expect(lanesOf('Billing copy')).toEqual([
      { repoRoot: '/repos/web', branch: 'billing' },
      THIS_LANE,
    ])
  })

  it('adds them too once ticked', async () => {
    fireEvent.click(suggestion())
    fireEvent.click(screen.getByRole('button', { name: /Billing copy/ }))
    await waitFor(() => expect(lanesOf('Billing copy')).toHaveLength(4))
    expect(lanesOf('Billing copy')?.map((l) => l.repoRoot)).toEqual([
      '/repos/web',
      '/repos/api-gateway',
      '/repos/terminator',
      '/repos/web',
    ])
  })
})

describe('Add to task — a new task', () => {
  it('makes a task named after the branch holding just this lane', async () => {
    fireEvent.click(screen.getByRole('button', { name: '+ New task from api-gateway/rate-limits' }))
    await waitFor(() => expect(lanesOf('rate-limits')).toEqual([THIS_LANE]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('holds the suggested lanes as well when they are ticked', async () => {
    fireEvent.click(suggestion())
    fireEvent.click(screen.getByRole('button', { name: '+ New task from api-gateway/rate-limits' }))
    await waitFor(() => expect(lanesOf('rate-limits')).toHaveLength(3))
  })
})
