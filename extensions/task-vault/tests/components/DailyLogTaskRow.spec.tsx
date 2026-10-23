import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, fireEvent, act } from '@testing-library/react'
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
describe('DailyLog task row: editing', editTests)
describe('DailyLog task row: editing, continued', editTestsPart2)
describe('DailyLog task row: open task actions', openActionTests)
describe('DailyLog task row: open task actions, continued', openActionTestsPart2)
describe('DailyLog task row: migrating', migrateTests)
describe('DailyLog task row: blocked and finished tasks', finishedTests)
describe('DailyLog task row: blocked and finished tasks, continued', finishedTestsPart2)
describe('DailyLog task row: tags', metaTests)
describe('DailyLog task row: tags, continued', metaTestsPart2)

function selectTests() {
  it('completes an open task from its checkbox', () => {
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(screen.getByTitle('Complete task'))
    expect(props.onTaskComplete).toHaveBeenCalledWith('t1')
  })

  it('selects an open task a moment after a single click', () => {
    vi.useFakeTimers()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(screen.getByText('Write'))
    expect(props.onSelectTask).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(220))
    expect(props.onSelectTask).toHaveBeenCalledWith('t1')
  })

  it('selects a finished task at once, and marks the selected row', () => {
    const { props } = renderDailyLog(task('t1', 'Write', { status: 'done' }), {
      onSelectTask: vi.fn(),
      ...{ selectedTaskId: 't1' },
    })
    expect(screen.getByTitle('Click to open detail')).toBeTruthy()
    fireEvent.click(screen.getByText('Write'))
    expect(props.onSelectTask).toHaveBeenCalledWith('t1')
    expect(document.querySelector('.daily-log__task--selected')).toBeTruthy()
    expect(document.querySelector('.daily-log__task-text--strikethrough')).toBeTruthy()
  })
}

function selectTestsPart2() {
  it('cancels a pending select when unmounted', () => {
    vi.useFakeTimers()
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(screen.getByText('Write'))
    cleanup()
    act(() => void vi.advanceTimersByTime(500))
    expect(props.onSelectTask).not.toHaveBeenCalled()
  })
}

function editTests() {
  it('edits on a double click, starting from the raw text', async () => {
    const { props } = renderDailyLog(
      task('t1', 'Write', {
        project: 'big job',
        context: 'desk',
        area: 'work',
        dueDate: '2026-02-01',
      }),
      { onSelectTask: vi.fn() }
    )
    fireEvent.click(screen.getByText('Write'))
    fireEvent.click(screen.getByText('Write'))
    const input = screen.getByLabelText('Task text') as HTMLInputElement
    expect(input.value).toBe('Write @big-job +desk #work due:2026-02-01')
    fireEvent.change(input, { target: { value: ' Rewrite ' } })
    fireEvent.click(buttonNamed('Save'))
    await eventually(() => expect(screen.queryByLabelText('Task text')).toBeNull())
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([{ taskId: 't1', text: 'Rewrite' }])
    expect(props.onRefresh).toHaveBeenCalled()
    expect(props.onSelectTask).not.toHaveBeenCalled()
  })
}

function editTestsPart2() {
  it('ignores a blank edit, and cancels by button or Escape', () => {
    renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(screen.getByText('Write'))
    fireEvent.click(screen.getByText('Write'))
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: ' ' } })
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Enter' })
    fireEvent.click(buttonNamed('Cancel edit'))
    fireEvent.click(screen.getByText('Write'))
    fireEvent.click(screen.getByText('Write'))
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Escape' })
    expect(screen.getByText('Write')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })
}

function openActionTests() {
  it('sends a task to the backlog', async () => {
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(buttonNamed('Send to backlog'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:process-inbox-item')).toEqual([
      { taskId: 't1', action: 'someday' },
    ])
    expect(lastNotice()).toEqual(['info', 'Moved to backlog: Write', 'taskMovedToBacklog'])
  })

  it('archives a task with a notice that leads back to it', async () => {
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(buttonNamed('Archive task'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:cancel-task')).toEqual([{ taskId: 't1' }])
    const [type, message, options] = lastNotice()!
    expect([type, message]).toEqual(['info', 'Archived: Write'])
    ;(options as { onClick: () => void }).onClick()
    expect(useVaultNavStore.getState().pendingTaskId).toBe('t1')
  })
}

function openActionTestsPart2() {
  it('adds the first subtask inline', async () => {
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(buttonNamed('Add subtask'))
    expect(buttonNamed('Add')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Subtask…'), { target: { value: ' step ' } })
    fireEvent.click(buttonNamed('Add'))
    await eventually(() => expect(screen.queryByLabelText('Subtask…')).toBeNull())
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([{ taskId: 't1', text: 'step' }])
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('cancels the first subtask by button or Escape, and ignores a blank one', () => {
    renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(buttonNamed('Add subtask'))
    fireEvent.keyDown(screen.getByLabelText('Subtask…'), { key: 'Enter' })
    fireEvent.click(buttonNamed('Cancel'))
    fireEvent.click(buttonNamed('Add subtask'))
    fireEvent.keyDown(screen.getByLabelText('Subtask…'), { key: 'Escape' })
    expect(screen.queryByLabelText('Subtask…')).toBeNull()
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([])
  })
}

function migrateTests() {
  it('migrates to a chosen day', async () => {
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(buttonNamed('Migrate to another day'))
    expect(buttonNamed('Move')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('date picker'), { target: { value: '2026-01-09' } })
    fireEvent.click(buttonNamed('Move'))
    await eventually(() => expect(screen.queryByLabelText('date picker')).toBeNull())
    expect(props.onTaskMigrate).toHaveBeenCalledWith('t1', '2026-01-09')
  })

  it('closes the migrate picker without moving', () => {
    const { props } = renderDailyLog(task('t1', 'Write'), { onSelectTask: vi.fn() })
    fireEvent.click(buttonNamed('Migrate to another day'))
    fireEvent.click(buttonNamed('Cancel move'))
    expect(screen.queryByLabelText('date picker')).toBeNull()
    expect(props.onTaskMigrate).not.toHaveBeenCalled()
  })
}

function finishedTests() {
  it('unblocks or archives a blocked task, and shows why it is blocked', async () => {
    const blocked = task('t1', 'Write', {
      status: 'blocked',
      blockedReason: 'waiting',
      blockedCheckInterval: '2-day',
    })
    const { props } = renderDailyLog(blocked, { onSelectTask: vi.fn() })
    expect(screen.getByTitle('Check in: 2 days').textContent).toBe('⊘ waiting')
    expect(document.querySelector('.daily-log__task--blocked')).toBeTruthy()
    expect(screen.queryByTitle('Complete task')).toBeNull()
    fireEvent.click(buttonNamed('Unblock'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:unblock-task')).toEqual([{ taskId: 't1' }])
    expect(lastNotice()?.slice(0, 2)).toEqual(['success', 'Unblocked: Write'])
  })

  it('adds a subtask to, or archives, a blocked task', async () => {
    const { props } = renderDailyLog(task('t1', 'Write', { status: 'blocked' }), {
      onSelectTask: vi.fn(),
    })
    fireEvent.click(buttonNamed('Add subtask'))
    expect(screen.getByLabelText('Subtask…')).toBeTruthy()
    fireEvent.click(buttonNamed('Archive task'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:cancel-task')).toEqual([{ taskId: 't1' }])
  })
}

function finishedTestsPart2() {
  it('restores a finished task', async () => {
    const { props } = renderDailyLog(task('t1', 'Write', { status: 'done' }), {
      onSelectTask: vi.fn(),
    })
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    fireEvent.click(buttonNamed('Restore to open'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:reopen-task')).toEqual([{ taskId: 't1' }])
    expect(lastNotice()?.slice(0, 2)).toEqual(['info', 'Reopened: Write'])
  })

  it('removes a cancelled or migrated task', async () => {
    const { props } = renderDailyLog(task('t1', 'Write', { status: 'cancelled' }), {
      onSelectTask: vi.fn(),
    })
    expect(document.querySelector('.daily-log__task--cancelled')).toBeTruthy()
    expect(document.querySelector('.daily-log__task-text--cancelled')).toBeTruthy()
    fireEvent.click(buttonNamed('Remove'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    cleanup()
    renderDailyLog(task('t2', 'Moved', { status: 'migrated' }), { onSelectTask: vi.fn() })
    fireEvent.click(buttonNamed('Remove'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:delete-task')).toEqual([
        { taskId: 't1' },
        { taskId: 't2' },
      ])
    )
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
    expect(screen.getByText('⊘ r').getAttribute('title')).toBeNull()
  })
}
