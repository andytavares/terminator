import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskList } from '../../../../src/components/home/TaskList'
import { ArchivedTasks } from '../../../../src/components/home/ArchivedTasks'
import { DismissedTasks } from '../../../../src/components/home/DismissedTasks'
import { taskKeyOf } from '../../../../src/home/task-lanes'
import { useDeskSelection } from '../../../../src/components/home/desk-selection'
import { useTaskStore } from '../../../../src/stores/task.store'
import { useParkedThreads } from '../../../../src/components/home/parked-threads'
import { useDismissedThreads } from '../../../../src/components/home/dismissed-threads'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { FACTS, REPO_ROOT, seedDesk } from '../home/desk-world'
import { task } from '../home/fixtures'
import type { Task, TaskUpdateInput } from '../../../../../core-shared/src/schemas/tasks.schema'

const spies = vi.hoisted(() => ({ facts: [] as unknown[] }))
vi.mock('../../../../src/components/session/useSessionFacts', () => ({
  useSessionFacts: () => spies.facts,
}))
vi.mock('../../../../src/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: () => <div role="dialog" aria-label="Link a work item" />,
}))
const deskFilter = vi.hoisted(() => ({
  text: '',
  count: null as string | null,
  taskState: null as string | null,
}))
vi.mock('../../../../src/components/home/desk-filter', () => ({
  useDeskFilter: () => deskFilter,
}))

const REPOS = ['/repos/terminator', '/repos/api-gateway', '/repos/web-console']
const THREE_LANES = REPOS.map((repoRoot) => ({ repoRoot, branch: 'rate-limits' }))
const NOW_ISO = new Date().toISOString()

/** A task store whose writes land the way main's would: the written task replaces its entry. */
function useWritableTasks(initial: Task[]): void {
  const change = (id: string, patch: (t: Task) => Task) =>
    useTaskStore.setState((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? patch(t) : t)) }))
  useTaskStore.setState({
    tasks: initial,
    update: vi.fn(async (input: TaskUpdateInput) => {
      change(input.id, (t) => ({
        ...t,
        focus: input.focus ?? t.focus,
        doneAt: input.done === undefined ? t.doneAt : input.done ? NOW_ISO : null,
      }))
      return true
    }),
    archive: vi.fn(async (id: string, archived: boolean) => {
      change(id, (t) => ({ ...t, archivedAt: archived ? NOW_ISO : null }))
      return true
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  deskFilter.text = ''
  deskFilter.count = null
  deskFilter.taskState = null
  spies.facts = FACTS
  seedDesk()
  useDeskSelection.setState({
    selectedThreadKey: null,
    openThreadKey: null,
    groupBy: 'move',
    expandedGroupIds: [],
  })
  useParkedThreads.setState({ keys: [] })
  useDismissedThreads.setState({ dismissed: {} })
  useTaskStore.setState({ tasks: [] })
  installElectronApi({})
})

/** A task store that keeps what is created and applies focus updates. */
function storeCreatedTasks(): void {
  const created: Task[] = []
  useTaskStore.setState({
    tasks: [],
    create: vi.fn(async (input) => {
      created.push(task({ id: 'c3333333-3333-4333-8333-333333333333', ...input, ticket: null }))
      useTaskStore.setState({ tasks: [...created] })
      return true
    }),
    update: vi.fn(async (input: TaskUpdateInput) => {
      useTaskStore.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === input.id ? { ...t, focus: input.focus ?? false } : t)),
      }))
      return true
    }),
  })
}

const groupHeadings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
const rowNamed = (title: string) => screen.getByRole('button', { name: title })

describe('TaskList', () => {
  it('lists tasks in focus order with a count per group, and never a stage', () => {
    render(<TaskList />)
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Tasks · 4')
    expect(groupHeadings()).toEqual([
      'Needs you · 1',
      'Running · 1',
      'Waiting on others · 1',
      'Quiet · 1',
    ])
    expect(screen.queryByText(/\bstage\b|Building|In review|Shipped/i)).toBeNull()
  })

  it('shows a task with its ticket, last activity and what it is doing now', () => {
    render(<TaskList />)
    const building = within(rowNamed('PR overview shows status before story'))
    expect(building.getByText('TAV-20')).toBeTruthy()
    expect(building.getByText('Writing ReviewHeader tests')).toBeTruthy()
    expect(building.getByText('1 m')).toBeTruthy()
    expect(building.getByRole('img', { name: 'Running' })).toBeTruthy()
  })

  it('collapses Quiet to one line until Show is pressed', async () => {
    const user = userEvent.setup()
    render(<TaskList />)
    expect(screen.queryByRole('button', { name: 'Scratch shell' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show Quiet' }))
    expect(screen.getByRole('button', { name: 'Scratch shell' })).toBeTruthy()
  })
})

describe('TaskList — a folded group header is one button', () => {
  const quietHeader = () => screen.getByRole('button', { name: /^(Show|Hide) Quiet$/ })

  it('opens and closes when the header row itself is clicked, not only its label', async () => {
    const user = userEvent.setup()
    render(<TaskList />)
    await user.click(screen.getByRole('heading', { level: 3, name: 'Quiet · 1' }))
    expect(screen.getByRole('button', { name: 'Scratch shell' })).toBeTruthy()
    expect(quietHeader().getAttribute('aria-expanded')).toBe('true')
    expect(within(quietHeader()).getByText('Hide ▾')).toBeTruthy()
    await user.click(quietHeader())
    expect(screen.queryByRole('button', { name: 'Scratch shell' })).toBeNull()
    expect(quietHeader().getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles with Enter and with Space from the keyboard', async () => {
    const user = userEvent.setup()
    render(<TaskList />)
    act(() => quietHeader().focus())
    expect(quietHeader().matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Scratch shell' })).toBeTruthy()
    await user.keyboard(' ')
    expect(screen.queryByRole('button', { name: 'Scratch shell' })).toBeNull()
  })

  it('is focusable and holds no second button inside it', () => {
    render(<TaskList />)
    expect(quietHeader().tabIndex).toBe(0)
    expect(within(quietHeader()).queryByRole('button')).toBeNull()
  })
})

describe('TaskList — pulse line', () => {
  it('shows only the state pressed on the pulse line', () => {
    deskFilter.taskState = 'running'
    render(<TaskList />)
    expect(groupHeadings()).toEqual(['Running · 1'])
  })
})

describe('TaskList — rows', () => {
  it('draws a three-lane task as one row with three repo chips', async () => {
    const user = userEvent.setup()
    useTaskStore.setState({ tasks: [task({ title: 'Rate limits', lanes: THREE_LANES })] })
    render(<TaskList />)
    await user.click(screen.getByRole('button', { name: 'Show Quiet' }))
    const row = within(screen.getAllByRole('button', { name: 'Rate limits' })[0])
    expect(row.getByText('terminator')).toBeTruthy()
    expect(row.getByText('api-gateway')).toBeTruthy()
    expect(row.getByText('web-console')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Rate limits' })).toHaveLength(1)
  })

  it('draws the task glyph, hollow when the ask is inferred', () => {
    spies.facts = [{ ...FACTS[1], askInferred: true }]
    render(<TaskList />)
    const asking = within(rowNamed('Reproduce staging 429s before release'))
    expect(asking.getByRole('img', { name: 'Needs you, inferred' })).toBeTruthy()
  })

  it('groups by repo and by none from the Group menu', async () => {
    const user = userEvent.setup()
    render(<TaskList />)
    await user.click(screen.getByRole('button', { name: 'Group: state' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'none' }))
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Scratch shell' })).toBeTruthy()
  })
})

describe('TaskList — selection and grouping', () => {
  it('opens the drawer state on Enter, as the Classic rows do', async () => {
    const user = userEvent.setup()
    render(<TaskList />)
    const row = rowNamed('PR overview shows status before story')
    act(() => row.focus())
    expect(row.matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(useDeskSelection.getState().openThreadKey).toBe('linear:TAV-20')
  })

  it('marks the selected row', () => {
    useDeskSelection.getState().select('linear:TAV-31')
    render(<TaskList />)
    expect(rowNamed('Reproduce staging 429s before release').getAttribute('aria-current')).toBe(
      'true'
    )
  })
})

describe('TaskList — focus star', () => {
  it('presses the star on a stored task and lifts the task to the top of its group', async () => {
    const first = task({ id: 'a1111111-1111-4111-8111-111111111111', title: 'Alpha', lanes: [] })
    const second = task({ id: 'b2222222-2222-4222-8222-222222222222', title: 'Beta', lanes: [] })
    spies.facts = []
    useWritableTasks([first, second])
    const user = userEvent.setup()
    render(<TaskList />)
    await user.click(screen.getByRole('button', { name: 'Show Quiet' }))
    expect(screen.getByRole('button', { name: 'Focus on Beta' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
    await user.click(screen.getByRole('button', { name: 'Focus on Beta' }))
    await screen.findByRole('button', { name: 'Focus on Beta', pressed: true })
    const titles = screen.getAllByRole('button', { name: /^(Alpha|Beta)$/ })
    expect(titles[0].getAttribute('aria-label')).toBe('Beta')
  })
})

describe('TaskList — focus star on an implicit thread', () => {
  it('stores an implicit thread as a task when its star is pressed', async () => {
    const user = userEvent.setup()
    storeCreatedTasks()
    render(<TaskList />)
    await user.click(
      within(rowNamed('Reproduce staging 429s before release')).getByRole('button', {
        name: /Focus on/,
      })
    )
    await within(rowNamed('Reproduce staging 429s before release')).findByRole('button', {
      name: /Focus on/,
      pressed: true,
    })
  })
})

describe('TaskList — done and archived', () => {
  it('moves a task to Done when Mark done is chosen, collapsed like Quiet', async () => {
    const user = userEvent.setup()
    const asking = task({
      title: 'Staging 429s',
      lanes: [{ repoRoot: REPO_ROOT, branch: 'tav-31' }],
    })
    useWritableTasks([asking])
    render(<TaskList />)
    expect(groupHeadings()).toContain('Needs you · 1')
    fireEvent.contextMenu(rowNamed('Staging 429s'))
    await user.click(screen.getByRole('menuitem', { name: 'Mark done' }))
    await waitFor(() => expect(groupHeadings()).toContain('Done · 1'))
    expect(groupHeadings()).not.toContain('Needs you · 1')
    expect(screen.queryByRole('button', { name: 'Staging 429s' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show Done' }))
    expect(within(rowNamed('Staging 429s')).getByRole('img', { name: 'Done' })).toBeTruthy()
  })
})

describe('ArchivedTasks', () => {
  const archived = task({
    title: 'Old spike',
    lanes: [{ repoRoot: REPO_ROOT, branch: 'spike' }],
    archivedAt: '2026-10-01T09:00:00.000Z',
  })

  it('counts archived tasks and lists them in a popover', async () => {
    useWritableTasks([archived])
    render(<ArchivedTasks />)
    await userEvent.click(screen.getByRole('button', { name: 'Archived tasks (1)' }))
    expect(
      within(screen.getByRole('group', { name: 'Archived tasks' })).getByText('Old spike')
    ).toBeTruthy()
  })

  it('brings a task back to the list when Restore is pressed', async () => {
    useWritableTasks([archived])
    render(
      <>
        <TaskList />
        <ArchivedTasks />
      </>
    )
    expect(groupHeadings()).toContain('Quiet · 1')
    await userEvent.click(screen.getByRole('button', { name: 'Archived tasks (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Restore Old spike' }))
    await screen.findByRole('button', { name: 'Archived tasks (0)' })
    expect(groupHeadings()).toContain('Quiet · 2')
  })
})

describe('DismissedTasks', () => {
  const dismissedTask = task({
    title: 'Flaky probe',
    lanes: [{ repoRoot: REPO_ROOT, branch: 'probe' }],
  })

  it('lists a dismissed task and brings it back to the list when Restore is pressed', async () => {
    const user = userEvent.setup()
    useWritableTasks([dismissedTask])
    useDismissedThreads.getState().dismiss(taskKeyOf(dismissedTask.id), Date.now(), false)
    render(
      <>
        <TaskList />
        <DismissedTasks />
      </>
    )
    expect(screen.queryByRole('button', { name: 'Flaky probe' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Dismissed (1)' }))
    await user.click(screen.getByRole('button', { name: 'Restore Flaky probe' }))
    await screen.findByRole('button', { name: 'Dismissed (0)' })
    expect(groupHeadings()).toContain('Quiet · 2')
  })
})

describe('ArchivedTasks — done tasks', () => {
  it('lists a done task and takes it out of the list when Undo done is pressed', async () => {
    const user = userEvent.setup()
    const finished = task({ title: 'Shipped spike', doneAt: '2026-10-02T09:00:00.000Z' })
    useWritableTasks([finished])
    render(<ArchivedTasks />)
    await user.click(screen.getByRole('button', { name: 'Archived tasks (1)' }))
    await user.click(screen.getByRole('button', { name: 'Undo done Shipped spike' }))
    await screen.findByRole('button', { name: 'Archived tasks (0)' })
  })
})
