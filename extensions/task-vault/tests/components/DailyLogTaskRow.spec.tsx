import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { installVaultBridge, eventually, task } from './helpers/bridge'
import type { IndexedTask } from '../../src/vault/types'

vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))
vi.mock('../../src/components/SmartTaskInput', () => import('./helpers/input-stubs'))
vi.mock('../../src/components/DateTimePicker', () => import('./helpers/input-stubs'))

import { DailyLog } from '../../src/components/DailyLog'
import { notify } from '../../src/utils/notify'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'

vi.setConfig({ testTimeout: 30_000 })

type Props = React.ComponentProps<typeof DailyLog>

let bridge: ReturnType<typeof installVaultBridge>

function renderTask(one: IndexedTask, overrides: Partial<Props> = {}) {
  const props: Props = {
    log: { date: '2026-01-05', filePath: 'daily/2026-01-05.md', tasks: [one], exists: true },
    onTaskComplete: vi.fn(async () => {}),
    onTaskMigrate: vi.fn(async () => {}),
    onRefresh: vi.fn(async () => {}),
    onSelectTask: vi.fn(),
    ...overrides,
  }
  render(React.createElement(DailyLog, props))
  return props
}

const button = (name: string) => screen.getByRole('button', { name })
const lastNotice = () => vi.mocked(notify).mock.calls.at(-1)

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
    const props = renderTask(task('t1', 'Write'))
    fireEvent.click(screen.getByTitle('Complete task'))
    expect(props.onTaskComplete).toHaveBeenCalledWith('t1')
  })

  it('selects an open task a moment after a single click', () => {
    vi.useFakeTimers()
    const props = renderTask(task('t1', 'Write'))
    fireEvent.click(screen.getByText('Write'))
    expect(props.onSelectTask).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(220))
    expect(props.onSelectTask).toHaveBeenCalledWith('t1')
  })

  it('selects a finished task at once, and marks the selected row', () => {
    const props = renderTask(task('t1', 'Write', { status: 'done' }), { selectedTaskId: 't1' })
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
    const props = renderTask(task('t1', 'Write'))
    fireEvent.click(screen.getByText('Write'))
    cleanup()
    act(() => vi.advanceTimersByTime(500))
    expect(props.onSelectTask).not.toHaveBeenCalled()
  })
}

function editTests() {
  it('edits on a double click, starting from the raw text', async () => {
    const props = renderTask(
      task('t1', 'Write', {
        project: 'big job',
        context: 'desk',
        area: 'work',
        dueDate: '2026-02-01',
      })
    )
    fireEvent.click(screen.getByText('Write'))
    fireEvent.click(screen.getByText('Write'))
    const input = screen.getByLabelText('Task text') as HTMLInputElement
    expect(input.value).toBe('Write @big-job +desk #work due:2026-02-01')
    fireEvent.change(input, { target: { value: ' Rewrite ' } })
    fireEvent.click(button('Save'))
    await eventually(() => expect(screen.queryByLabelText('Task text')).toBeNull())
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([{ taskId: 't1', text: 'Rewrite' }])
    expect(props.onRefresh).toHaveBeenCalled()
    expect(props.onSelectTask).not.toHaveBeenCalled()
  })
}

function editTestsPart2() {
  it('ignores a blank edit, and cancels by button or Escape', () => {
    renderTask(task('t1', 'Write'))
    fireEvent.click(screen.getByText('Write'))
    fireEvent.click(screen.getByText('Write'))
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: ' ' } })
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Enter' })
    fireEvent.click(button('Cancel edit'))
    fireEvent.click(screen.getByText('Write'))
    fireEvent.click(screen.getByText('Write'))
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Escape' })
    expect(screen.getByText('Write')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })
}

function openActionTests() {
  it('sends a task to the backlog', async () => {
    const props = renderTask(task('t1', 'Write'))
    fireEvent.click(button('Send to backlog'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:process-inbox-item')).toEqual([
      { taskId: 't1', action: 'someday' },
    ])
    expect(lastNotice()).toEqual(['info', 'Moved to backlog: Write', 'taskMovedToBacklog'])
  })

  it('archives a task with a notice that leads back to it', async () => {
    const props = renderTask(task('t1', 'Write'))
    fireEvent.click(button('Archive task'))
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
    const props = renderTask(task('t1', 'Write'))
    fireEvent.click(button('Add subtask'))
    expect(button('Add')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Subtask…'), { target: { value: ' step ' } })
    fireEvent.click(button('Add'))
    await eventually(() => expect(screen.queryByLabelText('Subtask…')).toBeNull())
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([{ taskId: 't1', text: 'step' }])
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('cancels the first subtask by button or Escape, and ignores a blank one', () => {
    renderTask(task('t1', 'Write'))
    fireEvent.click(button('Add subtask'))
    fireEvent.keyDown(screen.getByLabelText('Subtask…'), { key: 'Enter' })
    fireEvent.click(button('Cancel'))
    fireEvent.click(button('Add subtask'))
    fireEvent.keyDown(screen.getByLabelText('Subtask…'), { key: 'Escape' })
    expect(screen.queryByLabelText('Subtask…')).toBeNull()
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([])
  })
}

function migrateTests() {
  it('migrates to a chosen day', async () => {
    const props = renderTask(task('t1', 'Write'))
    fireEvent.click(button('Migrate to another day'))
    expect(button('Move')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('date picker'), { target: { value: '2026-01-09' } })
    fireEvent.click(button('Move'))
    await eventually(() => expect(screen.queryByLabelText('date picker')).toBeNull())
    expect(props.onTaskMigrate).toHaveBeenCalledWith('t1', '2026-01-09')
  })

  it('closes the migrate picker without moving', () => {
    const props = renderTask(task('t1', 'Write'))
    fireEvent.click(button('Migrate to another day'))
    fireEvent.click(button('Cancel move'))
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
    const props = renderTask(blocked)
    expect(screen.getByTitle('Check in: 2 days').textContent).toBe('⊘ waiting')
    expect(document.querySelector('.daily-log__task--blocked')).toBeTruthy()
    expect(screen.queryByTitle('Complete task')).toBeNull()
    fireEvent.click(button('Unblock'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:unblock-task')).toEqual([{ taskId: 't1' }])
    expect(lastNotice()?.slice(0, 2)).toEqual(['success', 'Unblocked: Write'])
  })

  it('adds a subtask to, or archives, a blocked task', async () => {
    const props = renderTask(task('t1', 'Write', { status: 'blocked' }))
    fireEvent.click(button('Add subtask'))
    expect(screen.getByLabelText('Subtask…')).toBeTruthy()
    fireEvent.click(button('Archive task'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:cancel-task')).toEqual([{ taskId: 't1' }])
  })
}

function finishedTestsPart2() {
  it('restores a finished task', async () => {
    const props = renderTask(task('t1', 'Write', { status: 'done' }))
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    fireEvent.click(button('Restore to open'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:reopen-task')).toEqual([{ taskId: 't1' }])
    expect(lastNotice()?.slice(0, 2)).toEqual(['info', 'Reopened: Write'])
  })

  it('removes a cancelled or migrated task', async () => {
    const props = renderTask(task('t1', 'Write', { status: 'cancelled' }))
    expect(document.querySelector('.daily-log__task--cancelled')).toBeTruthy()
    expect(document.querySelector('.daily-log__task-text--cancelled')).toBeTruthy()
    fireEvent.click(button('Remove'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    cleanup()
    renderTask(task('t2', 'Moved', { status: 'migrated' }))
    fireEvent.click(button('Remove'))
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
    renderTask(
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
      })
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
    renderTask(task('t1', 'Write'))
    expect(document.querySelector('.daily-log__task-meta')).toBeNull()
    cleanup()
    renderTask(task('t1', 'Write', { recurrenceRule: 'daily', recurrenceNotifyAt: '00:30' }))
    expect(screen.getByTitle('Repeats: Daily at 12:30 AM')).toBeTruthy()
    expect(button('Recurrence: Daily')).toBeTruthy()
  })

  it('names an unknown rule as itself, and a reason without a check-in plainly', () => {
    renderTask(task('t1', 'W', { recurrenceRule: 'yearly', status: 'blocked', blockedReason: 'r' }))
    expect(screen.getByTitle('Repeats: yearly')).toBeTruthy()
    expect(screen.getByText('⊘ r').getAttribute('title')).toBeNull()
  })
}
