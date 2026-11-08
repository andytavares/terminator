import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installVaultBridge, eventually, task, dayFromToday } from './helpers/bridge'
import { restoreLocalClock, setLocalClock } from '../support/clock'
import type { IndexedTask } from '../../src/vault/types'

vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))
vi.mock('../../src/components/SmartTaskInput', () => import('./helpers/input-stubs'))

import { DailyLog } from '../../src/components/DailyLog'

type Props = React.ComponentProps<typeof DailyLog>

let bridge: ReturnType<typeof installVaultBridge>

function logOf(tasks: IndexedTask[]) {
  return { date: '2026-01-05', filePath: 'daily/2026-01-05.md', tasks, exists: true }
}

function renderLog(overrides: Partial<Props> = {}) {
  const props: Props = {
    log: logOf([task('t1', 'Write'), task('t2', 'Read', { status: 'done' })]),
    onTaskComplete: vi.fn(async () => {}),
    onTaskMigrate: vi.fn(async () => {}),
    onRefresh: vi.fn(async () => {}),
    ...overrides,
  }
  render(React.createElement(DailyLog, props))
  return props
}

const taskRowElements = () =>
  screen.queryAllByRole('group').map((row) => row.getAttribute('aria-label'))

beforeEach(() => {
  setLocalClock('UTC', '2026-01-15T12:00:00.000Z')
  bridge = installVaultBridge()
})

afterEach(() => {
  cleanup()
  restoreLocalClock()
})

describe('DailyLog usage', () => {
  it('counts one view of the daily log, not each re-render', () => {
    renderLog()
    expect(bridge.recordUsage.mock.calls).toEqual([['view-daily-log']])
  })
})

describe('DailyLog heading', headingTests)
describe('DailyLog day navigation', dayNavigationTests)
describe('DailyLog progress and sections', sectionTests)
describe('DailyLog progress and sections, continued', sectionTestsPart2)
describe('DailyLog empty day', emptyDayTests)
describe('DailyLog empty day actions', emptyDayActionTests)
describe('DailyLog adding tasks', addTaskTests)
describe('DailyLog closing the add row', addRowClosingTests)
describe('DailyLog reordering', dailyLogDragTests)
describe('DailyLog reordering, continued', dragTestsPart2)
describe('DailyLog stale tasks', staleTests)
describe('DailyLog stale tasks, not flagged', staleNotFlaggedTests)
describe('DailyLog backlog', backlogTests)
describe('DailyLog backlog, continued', backlogTestsPart2)
describe('DailyLog backlog editing', backlogEditTests)
describe('DailyLog backlog editing, continued', backlogEditTestsPart2)
describe('DailyLog backlog editing, cancelling', backlogEditCancelTests)

function headingTests() {
  it('shows the date and marks today with a badge instead of a Today button', () => {
    renderLog({ isToday: true, onPrevDay: vi.fn(), onNextDay: vi.fn(), onGoToToday: vi.fn() })
    expect(screen.getByText('Monday, January 5')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByText('2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull()
  })

  it('goes back to today with the Today button, shown with no badge on another day', async () => {
    const user = userEvent.setup()
    const onGoToToday = vi.fn()
    renderLog({ onGoToToday })
    expect(screen.getAllByText('Today')).toEqual([
      screen.getByRole('button', { name: 'Back to today' }),
    ])
    await user.click(screen.getByRole('button', { name: 'Back to today' }))
    expect(onGoToToday).toHaveBeenCalledOnce()
  })
}

function dayNavigationTests() {
  it.each([
    { button: 'Previous day', handler: 'onPrevDay' },
    { button: 'Next day', handler: 'onNextDay' },
  ] as const)('calls $handler once when $button is pressed', async ({ button, handler }) => {
    const user = userEvent.setup()
    const props = renderLog({ onPrevDay: vi.fn(), onNextDay: vi.fn() })
    await user.click(screen.getByRole('button', { name: button }))
    expect(props[handler]).toHaveBeenCalledOnce()
  })

  it('disables the day navigation it was not given', () => {
    renderLog()
    expect(screen.getByRole('button', { name: 'Previous day' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Next day' })).toHaveProperty('disabled', true)
  })
}

function sectionTests() {
  it('counts done tasks, fills the bar, and lists active before finished', () => {
    renderLog({
      log: logOf([task('d', 'Done one', { status: 'done' }), task('o', 'Open one')]),
    })
    expect(screen.getByText('1/2')).toBeTruthy()
    const progress = screen.getByRole('progressbar', { name: 'Tasks done' })
    expect(progress.getAttribute('aria-valuenow')).toBe('50')
    expect(taskRowElements()).toEqual(['Open one', 'Done one'])
    expect(screen.getByRole('separator')).toBeTruthy()
  })

  it('marks the bar complete when everything is done', () => {
    renderLog({ log: logOf([task('d', 'Done', { status: 'done' })]) })
    const progress = screen.getByRole('progressbar', { name: 'Tasks done' })
    expect(progress.getAttribute('aria-valuenow')).toBe('100')
    expect(screen.queryByRole('separator')).toBeNull()
  })
}

function renderRolledOverLog() {
  return renderLog({
    log: logOf([
      task('a', 'Old', { context: 'home' }),
      task('b', 'New'),
      task('c', 'Desk', { context: 'desk' }),
    ]),
    rolledOverTaskIds: ['a'],
    selectedContexts: ['home', 'desk'],
  })
}

function sectionTestsPart2() {
  it('groups rolled-over tasks apart from today and filters by context', () => {
    renderRolledOverLog()
    expect(screen.getByText(/From previous days \(1\)/)).toBeTruthy()
    expect(taskRowElements()).toEqual(['Old', 'Desk'])
    expect(screen.getByText('Today')).toBeTruthy()
  })

  it('collapses the rolled-over group when its heading is pressed', async () => {
    const user = userEvent.setup()
    renderRolledOverLog()
    await user.click(screen.getByText(/From previous days/))
    expect(taskRowElements()).toEqual(['Desk'])
  })
}

function emptyDayTests() {
  it('shows one empty state on a day with no tasks and no backlog', () => {
    renderLog({ log: logOf([]), onOpenInbox: vi.fn() })
    expect(screen.getByText('Nothing logged today')).toBeTruthy()
    expect(screen.queryByText('+ Add task')).toBeNull()
    expect(screen.queryByText('No backlog items.')).toBeNull()
    expect(screen.queryByRole('progressbar', { name: 'Tasks done' })).toBeNull()
  })

  it('is not empty while the backlog holds something', () => {
    renderLog({ log: logOf([]), somedayTasks: [task('s', 'Later')] })
    expect(screen.queryByText('Nothing logged today')).toBeNull()
    expect(screen.getByText('+ Add task')).toBeTruthy()
  })
}

function emptyDayActionTests() {
  it('opens the inbox from the empty state', async () => {
    const user = userEvent.setup()
    const onOpenInbox = vi.fn()
    renderLog({ log: logOf([]), onOpenInbox })
    await user.click(screen.getByRole('button', { name: 'Open inbox' }))
    expect(onOpenInbox).toHaveBeenCalledOnce()
  })

  it('opens the add row from the empty state', async () => {
    const user = userEvent.setup()
    renderLog({ log: logOf([]), onOpenInbox: vi.fn() })
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByLabelText('Task text')).toBeTruthy()
  })
}

async function openAddRow() {
  const user = userEvent.setup()
  const props = renderLog()
  await user.click(screen.getByText('+ Add task'))
  return { user, props }
}

function addTaskTests() {
  it('adds a trimmed task to the day and refreshes', async () => {
    const { user, props } = await openAddRow()
    await user.type(screen.getByLabelText('Task text'), '  Ship it ')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('+ Add task')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:add-task')).toEqual([
      { filePath: 'daily/2026-01-05.md', text: 'Ship it' },
    ])
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('keeps Add disabled while the task text is empty', async () => {
    await openAddRow()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true)
  })

  it('adds nothing when Enter is pressed on empty text', async () => {
    const { user } = await openAddRow()
    await user.type(screen.getByLabelText('Task text'), '{Enter}')
    expect(bridge.calls('task-vault:vault:add-task')).toEqual([])
  })
}

function addRowClosingTests() {
  it('closes the add row with Escape', async () => {
    const { user } = await openAddRow()
    await user.type(screen.getByLabelText('Task text'), '{Escape}')
    expect(screen.queryByLabelText('Task text')).toBeNull()
    expect(screen.getByText('+ Add task')).toBeTruthy()
  })

  it('closes the add row with Cancel', async () => {
    const { user } = await openAddRow()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Task text')).toBeNull()
    expect(screen.getByText('+ Add task')).toBeTruthy()
  })
}

function taskRowNamed(text: string): HTMLElement {
  return screen.getByRole('group', { name: text })
}

function dataTransfer() {
  return { dropEffect: '', effectAllowed: '' }
}

function dailyLogDragTests() {
  it('reorders active tasks by drag and drop', async () => {
    const props = renderLog({ log: logOf([task('a', 'A'), task('b', 'B'), task('c', 'C')]) })
    const transfer = dataTransfer()
    fireEvent.dragStart(taskRowNamed('A'), { dataTransfer: transfer })
    expect(transfer.effectAllowed).toBe('move')
    fireEvent.dragOver(taskRowNamed('C'), { dataTransfer: transfer })
    expect(transfer.dropEffect).toBe('move')
    expect(taskRowNamed('C').className).toContain('daily-log__task--drag-over')
    fireEvent.drop(taskRowNamed('C'), { dataTransfer: transfer })
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:reorder-tasks')).toEqual([
        { orderedIds: ['b', 'c', 'a'] },
      ])
    )
    expect(props.onRefresh).toHaveBeenCalled()
    expect(taskRowNamed('C').className).not.toContain('drag-over')
  })
}

function dragTestsPart2() {
  it('ignores a drop on itself, a drop with no drag, and finished tasks', async () => {
    renderLog({ log: logOf([task('a', 'A'), task('d', 'D', { status: 'done' })]) })
    expect(taskRowNamed('D').getAttribute('draggable')).not.toBe('true')
    fireEvent.drop(taskRowNamed('A'), { dataTransfer: dataTransfer() })
    fireEvent.dragStart(taskRowNamed('A'), { dataTransfer: dataTransfer() })
    fireEvent.drop(taskRowNamed('A'), { dataTransfer: dataTransfer() })
    fireEvent.dragStart(taskRowNamed('A'), { dataTransfer: dataTransfer() })
    fireEvent.dragEnd(taskRowNamed('A'))
    fireEvent.drop(taskRowNamed('A'), { dataTransfer: dataTransfer() })
    await act(async () => {})
    expect(bridge.calls('task-vault:vault:reorder-tasks')).toEqual([])
  })
}

function staleLog() {
  return logOf([
    task('old', 'Old', { todaySince: dayFromToday(-3) }),
    task('new', 'New', { todaySince: dayFromToday(-2) }),
    task('fin', 'Fin', { todaySince: dayFromToday(-9), status: 'done' }),
  ])
}

function staleTests() {
  it('flags only an open task rolling over past the threshold', () => {
    renderLog({ isToday: true, staleDaysThreshold: 3, log: staleLog() })
    expect(taskRowNamed('Old').className).toContain('daily-log__task--stale')
    expect(taskRowNamed('New').className).not.toContain('stale')
    expect(taskRowNamed('Fin').className).not.toContain('stale')
  })

  it('keeps a stale task on request and refreshes', async () => {
    const user = userEvent.setup()
    const props = renderLog({ isToday: true, staleDaysThreshold: 3, log: staleLog() })
    await user.click(screen.getByRole('button', { name: 'keep' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:reset-today-since')).toEqual([{ taskId: 'old' }])
    )
    expect(props.onRefresh).toHaveBeenCalled()
  })
}

function staleNotFlaggedTests() {
  it.each([
    { when: 'on another day', props: { isToday: false, staleDaysThreshold: 3 } },
    { when: 'without a threshold', props: { isToday: true } },
  ])('flags no task $when', ({ props }) => {
    renderLog({ ...props, log: logOf([task('old', 'Old', { todaySince: '2000-01-01' })]) })
    expect(taskRowNamed('Old').className).not.toContain('stale')
    expect(screen.queryByRole('button', { name: 'keep' })).toBeNull()
  })
}

function backlogTests() {
  it('lists the backlog with its tags', () => {
    renderLog({
      somedayTasks: [task('s1', 'Later', { project: 'p', area: 'a', context: 'c' })],
    })
    expect(screen.getByText('Backlog (1)')).toBeTruthy()
    expect(screen.getByText('Later').textContent).toBe('Later@p#a+c')
  })

  it('collapses the backlog when its heading is pressed', async () => {
    const user = userEvent.setup()
    renderLog({ somedayTasks: [task('s1', 'Later')] })
    await user.click(screen.getByText('Backlog (1)'))
    expect(screen.queryByText('Later')).toBeNull()
  })

  it('says when the backlog is empty', () => {
    renderLog()
    expect(screen.getByText('No backlog items.')).toBeTruthy()
  })
}

function backlogTestsPart2() {
  it.each([
    { button: 'Pick up today', handler: 'onPickUpToday' },
    { button: 'Delete', handler: 'onDeleteBacklogTask' },
  ] as const)(
    'calls $handler with the task when $button is pressed',
    async ({ button, handler }) => {
      const user = userEvent.setup()
      const props = renderLog({
        somedayTasks: [task('s1', 'Later')],
        onPickUpToday: vi.fn(async () => {}),
        onDeleteBacklogTask: vi.fn(async () => {}),
      })
      await user.click(screen.getByRole('button', { name: button }))
      expect(props[handler]).toHaveBeenCalledWith('s1')
    }
  )

  it('selects a backlog task when it is clicked', async () => {
    const user = userEvent.setup()
    const onSelectTask = vi.fn()
    renderLog({ somedayTasks: [task('s1', 'Later')], onSelectTask })
    await user.click(screen.getByText('Later'))
    expect(onSelectTask).toHaveBeenCalledWith('s1')
  })

  it('offers no actions it was not given', () => {
    renderLog({ somedayTasks: [task('s1', 'Later')] })
    expect(screen.queryByRole('button', { name: 'Pick up today' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
}

function backlogEditTests() {
  it('edits a backlog task from its raw text on double-click', async () => {
    const user = userEvent.setup()
    const onRefreshBacklog = vi.fn(async () => {})
    const later = task('s1', 'Later', {
      project: 'big job',
      context: 'c',
      area: 'a',
      dueDate: '2026-02-01',
    })
    renderLog({ somedayTasks: [later], onRefreshBacklog })
    await user.dblClick(screen.getByText('Later'))
    const input = screen.getByLabelText('Task text')
    expect(input).toHaveProperty('value', 'Later @big-job +c #a due:2026-02-01')
    expect(screen.queryByRole('button', { name: 'Pick up today' })).toBeNull()
    await user.clear(input)
    await user.type(input, ' Sooner ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() => expect(onRefreshBacklog).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([{ taskId: 's1', text: 'Sooner' }])
  })
}

async function editLaterTask() {
  const user = userEvent.setup()
  renderLog({ somedayTasks: [task('s1', 'Later')] })
  await user.dblClick(screen.getByText('Later'))
  return { user, input: screen.getByLabelText('Task text') }
}

function backlogEditTestsPart2() {
  it('reverts a blanked edit without saving it', async () => {
    const { user, input } = await editLaterTask()
    await user.clear(input)
    await user.type(input, '  {Enter}')
    expect(await screen.findByText('Later')).toBeTruthy()
    expect(screen.queryByLabelText('Task text')).toBeNull()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })
}

function backlogEditCancelTests() {
  it('cancels a backlog edit with Cancel edit', async () => {
    const { user } = await editLaterTask()
    await user.click(screen.getByRole('button', { name: 'Cancel edit' }))
    expect(screen.queryByLabelText('Task text')).toBeNull()
    expect(screen.getByText('Later')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })

  it('cancels a backlog edit with Escape', async () => {
    const { user, input } = await editLaterTask()
    await user.type(input, 'r{Escape}')
    expect(screen.queryByLabelText('Task text')).toBeNull()
    expect(screen.getByText('Later')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })
}
