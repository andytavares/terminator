import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { installVaultBridge, eventually, task } from './helpers/bridge'
import { buttonNamed, lastNotice, renderDailyLog } from './helpers/daily-log'

vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))
vi.mock('../../src/components/SmartTaskInput', () => import('./helpers/input-stubs'))
vi.mock('../../src/components/DateTimePicker', () => import('./helpers/input-stubs'))

import { notify } from '../../src/utils/notify'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'

let bridge: ReturnType<typeof installVaultBridge>

beforeEach(() => {
  vi.mocked(notify).mockClear()
  bridge = installVaultBridge()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('DailyLog task row: completing and selecting', selectTests)
describe('DailyLog task row: completing and selecting, continued', selectTestsPart2)
describe('DailyLog task row: usage', completeUsageTests)
describe('DailyLog task row: editing', editTests)
describe('DailyLog task row: editing, continued', editTestsPart2)
describe('DailyLog task row: open task actions', openActionTests)
describe('DailyLog task row: first subtask', firstSubtaskTests)
describe('DailyLog task row: first subtask, continued', firstSubtaskTestsPart2)
describe('DailyLog task row: migrating', migrateTests)
describe('DailyLog task row: blocked tasks', blockedTests)
describe('DailyLog task row: blocked tasks, continued', blockedTestsPart2)
describe('DailyLog task row: finished tasks', finishedTests)
describe('DailyLog task row: tags', metaTests)
describe('DailyLog task row: tags, continued', metaTestsPart2)

function completeUsageTests() {
  it('counts a completed task', async () => {
    const user = userEvent.setup()
    renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(screen.getByTitle('Complete task'))
    await eventually(() => expect(bridge.recordUsage).toHaveBeenCalledWith('task-complete'))
  })
}

function selectTests() {
  it('completes an open task from its checkbox', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(screen.getByTitle('Complete task'))
    expect(props.onTaskComplete).toHaveBeenCalledWith('t1')
  })

  it('selects an open task a moment after a single click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(screen.getByText('Write'))
    expect(props.onSelectTask).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(220))
    expect(props.onSelectTask).toHaveBeenCalledWith('t1')
  })

  it('selects a finished task at once on a click', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write', { status: 'done' }), {
      onSelectTask: vi.fn(),
    })
    expect(screen.getByText('Write').title).toBe('Click to open detail')
    await user.click(screen.getByText('Write'))
    expect(props.onSelectTask).toHaveBeenCalledWith('t1')
  })
}

function selectTestsPart2() {
  it('marks the selected finished row, its text struck through', () => {
    renderDailyLog(task('t1', 'Write', { status: 'done' }), { selectedTaskId: 't1' })
    expect(document.querySelector('.daily-log__task--selected')).not.toBeNull()
    expect(screen.getByText('Write').className).toContain('daily-log__task-text--strikethrough')
  })

  it('cancels a pending select when unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(screen.getByText('Write'))
    cleanup()
    act(() => void vi.advanceTimersByTime(500))
    expect(props.onSelectTask).not.toHaveBeenCalled()
  })
}

function editTests() {
  it('opens the editor on a double click, holding the raw text with its tags', async () => {
    const user = userEvent.setup()
    const tagged = { project: 'big job', context: 'desk', area: 'work', dueDate: '2026-02-01' }
    renderDailyLog(task('t1', 'Write', tagged), { onSelectTask: vi.fn() })
    await user.dblClick(screen.getByText('Write'))
    expect(screen.getByLabelText('Task text')).toHaveProperty(
      'value',
      'Write @big-job +desk #work due:2026-02-01'
    )
  })

  it('saves the trimmed edit without selecting the task', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.dblClick(screen.getByText('Write'))
    await user.clear(screen.getByLabelText('Task text'))
    await user.type(screen.getByLabelText('Task text'), ' Rewrite ')
    await user.click(buttonNamed('Save'))
    await eventually(() => expect(screen.queryByLabelText('Task text')).toBeNull())
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([{ taskId: 't1', text: 'Rewrite' }])
    expect(props.onRefresh).toHaveBeenCalled()
    expect(props.onSelectTask).not.toHaveBeenCalled()
  })
}

function editTestsPart2() {
  it('saves nothing when a blank edit is submitted with Enter', async () => {
    const user = userEvent.setup()
    renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.dblClick(screen.getByText('Write'))
    await user.clear(screen.getByLabelText('Task text'))
    await user.type(screen.getByLabelText('Task text'), ' {Enter}')
    expect(screen.getByLabelText('Task text')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })

  it.each([
    ['the Cancel edit button', (user: UserEvent) => user.click(buttonNamed('Cancel edit'))],
    ['Escape', (user: UserEvent) => user.type(screen.getByLabelText('Task text'), '{Escape}')],
  ])('closes the editor on %s, showing the text again', async (_how, close) => {
    const user = userEvent.setup()
    renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.dblClick(screen.getByText('Write'))
    await close(user)
    expect(screen.queryByLabelText('Task text')).toBeNull()
    expect(screen.getByText('Write')).toBeTruthy()
  })
}

function openActionTests() {
  it('sends a task to the backlog', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Send to backlog'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:process-inbox-item')).toEqual([
      { taskId: 't1', action: 'someday' },
    ])
    expect(lastNotice()).toEqual(['info', 'Moved to backlog: Write', 'taskMovedToBacklog'])
  })

  it('archives a task with a notice that leads back to it', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Archive task'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:cancel-task')).toEqual([{ taskId: 't1' }])
    const [type, message, options] = lastNotice()!
    expect([type, message]).toEqual(['info', 'Archived: Write'])
    ;(options as { onClick: () => void }).onClick()
    expect(useVaultNavStore.getState().pendingTaskId).toBe('t1')
  })
}

function firstSubtaskTests() {
  it('adds the first subtask inline', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Add subtask'))
    expect(buttonNamed('Add')).toHaveProperty('disabled', true)
    await user.type(screen.getByLabelText('Subtask…'), ' step ')
    await user.click(buttonNamed('Add'))
    await eventually(() => expect(screen.queryByLabelText('Subtask…')).toBeNull())
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([{ taskId: 't1', text: 'step' }])
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('adds nothing when Enter is pressed on a blank first subtask', async () => {
    const user = userEvent.setup()
    renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Add subtask'))
    await user.type(screen.getByLabelText('Subtask…'), '{Enter}')
    expect(screen.getByLabelText('Subtask…')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([])
  })
}

function firstSubtaskTestsPart2() {
  it.each([
    ['the Cancel button', (user: UserEvent) => user.click(buttonNamed('Cancel'))],
    ['Escape', (user: UserEvent) => user.type(screen.getByLabelText('Subtask…'), '{Escape}')],
  ])('closes the first subtask row on %s', async (_how, close) => {
    const user = userEvent.setup()
    renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Add subtask'))
    await close(user)
    expect(screen.queryByLabelText('Subtask…')).toBeNull()
  })
}

function migrateTests() {
  it('migrates to a chosen day', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Migrate to another day'))
    expect(buttonNamed('Move')).toHaveProperty('disabled', true)
    await user.type(screen.getByLabelText('date picker'), '2026-01-09')
    await user.click(buttonNamed('Move'))
    await eventually(() => expect(screen.queryByLabelText('date picker')).toBeNull())
    expect(props.onTaskMigrate).toHaveBeenCalledWith('t1', '2026-01-09')
  })

  it('closes the migrate picker without moving', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Migrate to another day'))
    await user.click(buttonNamed('Cancel move'))
    expect(screen.queryByLabelText('date picker')).toBeNull()
    expect(props.onTaskMigrate).not.toHaveBeenCalled()
  })
}

const blockedTask = () =>
  task('t1', 'Write', {
    status: 'blocked',
    blockedReason: 'waiting',
    blockedCheckInterval: '2-day',
  })

function blockedTests() {
  it('shows why a blocked task is blocked, with no checkbox', () => {
    renderDailyLog(blockedTask(), { onSelectTask: vi.fn() })
    expect(screen.getByTitle('Check in: 2 days').textContent).toBe('⊘ waiting')
    expect(document.querySelector('.daily-log__task--blocked')).not.toBeNull()
    expect(screen.queryByTitle('Complete task')).toBeNull()
  })

  it('unblocks a blocked task with a notice', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(blockedTask(), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Unblock'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:unblock-task')).toEqual([{ taskId: 't1' }])
    expect(lastNotice()?.slice(0, 2)).toEqual(['success', 'Unblocked: Write'])
  })
}

function blockedTestsPart2() {
  it('opens the subtask row under a blocked task', async () => {
    const user = userEvent.setup()
    renderDailyLog(task('t1', 'Write', { status: 'blocked' }), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Add subtask'))
    expect(screen.getByLabelText('Subtask…')).toHaveProperty('value', '')
  })

  it('archives a blocked task', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write', { status: 'blocked' }), {
      onSelectTask: vi.fn(),
    })
    await user.click(buttonNamed('Archive task'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:cancel-task')).toEqual([{ taskId: 't1' }])
  })
}

function finishedTests() {
  it('restores a finished task', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write', { status: 'done' }), {
      onSelectTask: vi.fn(),
    })
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    await user.click(buttonNamed('Restore to open'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:reopen-task')).toEqual([{ taskId: 't1' }])
    expect(lastNotice()?.slice(0, 2)).toEqual(['info', 'Reopened: Write'])
  })

  it('shows a cancelled task with the cancelled row and text styles', () => {
    renderDailyLog(task('t1', 'Write', { status: 'cancelled' }), { onSelectTask: vi.fn() })
    expect(document.querySelector('.daily-log__task--cancelled')).not.toBeNull()
    expect(screen.getByText('Write').className).toContain('daily-log__task-text--cancelled')
  })

  it.each(['cancelled', 'migrated'] as const)('removes a %s task', async (status) => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write', { status }), { onSelectTask: vi.fn() })
    await user.click(buttonNamed('Remove'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:delete-task')).toEqual([{ taskId: 't1' }])
  })
}

function metaTests() {
  it('shows the tags, a custom check-in, and the recurrence', () => {
    renderDailyLog(
      task('t1', 'Write', {
        status: 'blocked',
        blockedReason: 'why',
        blockedCheckInterval: '2026-03-01T09:00',
        project: 'p',
        context: 'c',
        area: 'a',
        dueDate: '2026-02-01',
        recurrenceRule: 'weekly:5,1',
        recurrenceNotifyAt: '13:05',
      }),
      { onSelectTask: vi.fn() }
    )
    const meta = document.querySelector('.daily-log__task-meta')!
    expect(meta.textContent).toContain('@p+c#adue:2026-02-01⊘ why')
    expect(
      screen.getByTitle(`Check in: ${new Date('2026-03-01T09:00').toLocaleString()}`)
    ).toBeTruthy()
    expect(screen.getByTitle('Repeats: Weekly · Mon, Fri at 1:05 PM')).toBeTruthy()
  })
}

function metaTestsPart2() {
  it('shows no meta line for a plain task, and midnight as 12 AM', () => {
    renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    expect(document.querySelector('.daily-log__task-meta')).toBeNull()
    cleanup()
    renderDailyLog(task('t1', 'Write', { recurrenceRule: 'daily', recurrenceNotifyAt: '00:30' }), {
      onSelectTask: vi.fn(),
    })
    expect(screen.getByTitle('Repeats: Daily at 12:30 AM')).toBeTruthy()
    expect(buttonNamed('Recurrence: Daily')).toBeTruthy()
  })

  it('names an unknown rule as itself, and a reason without a check-in plainly', () => {
    renderDailyLog(
      task('t1', 'W', { recurrenceRule: 'yearly', status: 'blocked', blockedReason: 'r' }),
      { onSelectTask: vi.fn() }
    )
    expect(screen.getByTitle('Repeats: yearly')).toBeTruthy()
    expect(screen.getByText('⊘ r').hasAttribute('title')).toBe(false)
  })
}
