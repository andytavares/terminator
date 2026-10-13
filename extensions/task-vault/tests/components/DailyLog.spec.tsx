import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { installVaultBridge, eventually, task } from './helpers/bridge'
import type { IndexedTask } from '../../src/vault/types'

vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))
vi.mock('../../src/components/SmartTaskInput', () => import('./helpers/input-stubs'))

import { DailyLog } from '../../src/components/DailyLog'

vi.setConfig({ testTimeout: 30_000 })

type Props = React.ComponentProps<typeof DailyLog>

let bridge: ReturnType<typeof installVaultBridge>

function localDay(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

const rows = () =>
  Array.from(document.querySelectorAll('.daily-log__task .daily-log__task-text')).map(
    (el) => el.textContent
  )

beforeEach(() => {
  bridge = installVaultBridge()
})

afterEach(() => cleanup())

describe('DailyLog heading', headingTests)
describe('DailyLog progress and sections', sectionTests)
describe('DailyLog progress and sections, continued', sectionTestsPart2)
describe('DailyLog empty day', emptyDayTests)
describe('DailyLog adding tasks', addTaskTests)
describe('DailyLog reordering', dragTests)
describe('DailyLog reordering, continued', dragTestsPart2)
describe('DailyLog stale tasks', staleTests)
describe('DailyLog backlog', backlogTests)
describe('DailyLog backlog, continued', backlogTestsPart2)
describe('DailyLog backlog editing', backlogEditTests)
describe('DailyLog backlog editing, continued', backlogEditTestsPart2)

function headingTests() {
  it('shows the date, marks today, and moves between days', () => {
    const onPrevDay = vi.fn()
    const onNextDay = vi.fn()
    renderLog({ isToday: true, onPrevDay, onNextDay, onGoToToday: vi.fn() })
    expect(document.querySelector('.daily-log__date-weekday')?.textContent).toBe(
      'Monday, January 5Today'
    )
    expect(document.querySelector('.daily-log__date-detail')?.textContent).toBe('2026')
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(onPrevDay).toHaveBeenCalledOnce()
    expect(onNextDay).toHaveBeenCalledOnce()
  })

  it('offers a way back to today, and disables navigation it was not given', () => {
    const onGoToToday = vi.fn()
    renderLog({ onGoToToday })
    expect(document.querySelector('.daily-log__today-badge')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onGoToToday).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Previous day' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Next day' })).toHaveProperty('disabled', true)
  })
}

function sectionTests() {
  it('counts done tasks, fills the bar, and lists active before finished', () => {
    renderLog({
      log: logOf([task('d', 'Done one', { status: 'done' }), task('o', 'Open one')]),
    })
    expect(document.querySelector('.daily-log__task-count')?.textContent).toBe('1/2')
    const fill = document.querySelector('.daily-log__progress-fill') as HTMLElement
    expect(fill.style.width).toBe('50%')
    expect(fill.className).not.toContain('--complete')
    expect(rows()).toEqual(['Open one', 'Done one'])
    expect(document.querySelector('.daily-log__done-divider')).toBeTruthy()
  })

  it('marks the bar complete when everything is done', () => {
    renderLog({ log: logOf([task('d', 'Done', { status: 'done' })]) })
    expect(document.querySelector('.daily-log__progress-fill--complete')).toBeTruthy()
    expect(document.querySelector('.daily-log__done-divider')).toBeNull()
  })
}

function sectionTestsPart2() {
  it('groups rolled-over tasks, which collapse, and filters by context', () => {
    renderLog({
      log: logOf([
        task('a', 'Old', { context: 'home' }),
        task('b', 'New'),
        task('c', 'Desk', { context: 'desk' }),
      ]),
      rolledOverTaskIds: ['a'],
      selectedContexts: ['home', 'desk'],
    })
    expect(screen.getByText(/From previous days \(1\)/)).toBeTruthy()
    expect(rows()).toEqual(['Old', 'Desk'])
    expect(document.querySelector('.daily-log__today-label')?.textContent).toBe('Today')
    fireEvent.click(screen.getByText(/From previous days/))
    expect(rows()).toEqual(['Desk'])
  })
}

function emptyDayTests() {
  it('shows one empty state that opens the add row or the inbox', () => {
    const onOpenInbox = vi.fn()
    renderLog({ log: logOf([]), onOpenInbox })
    expect(screen.getByText('Nothing logged today')).toBeTruthy()
    expect(screen.queryByText('+ Add task')).toBeNull()
    expect(screen.queryByText('No backlog items.')).toBeNull()
    expect(document.querySelector('.daily-log__task-count')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open inbox' }))
    expect(onOpenInbox).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByLabelText('Task text')).toBeTruthy()
  })

  it('is not empty while the backlog holds something', () => {
    renderLog({ log: logOf([]), somedayTasks: [task('s', 'Later')] })
    expect(screen.queryByText('Nothing logged today')).toBeNull()
    expect(screen.getByText('+ Add task')).toBeTruthy()
  })
}

function addTaskTests() {
  it('adds a trimmed task to the day and refreshes', async () => {
    const props = renderLog()
    fireEvent.click(screen.getByText('+ Add task'))
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: '  Ship it ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await eventually(() => expect(screen.getByText('+ Add task')).toBeTruthy())
    expect(bridge.calls('task-vault:vault:add-task')).toEqual([
      { filePath: 'daily/2026-01-05.md', text: 'Ship it' },
    ])
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('ignores blank submits, and closes on Escape or Cancel', () => {
    renderLog()
    fireEvent.click(screen.getByText('+ Add task'))
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Enter' })
    expect(bridge.calls('task-vault:vault:add-task')).toEqual([])
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Escape' })
    fireEvent.click(screen.getByText('+ Add task'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('+ Add task')).toBeTruthy()
  })
}

function taskRow(text: string): HTMLElement {
  return screen.getByText(text).closest('.daily-log__task') as HTMLElement
}

function dataTransfer() {
  return { dropEffect: '', effectAllowed: '' }
}

function dragTests() {
  it('reorders active tasks by drag and drop', async () => {
    const props = renderLog({ log: logOf([task('a', 'A'), task('b', 'B'), task('c', 'C')]) })
    const transfer = dataTransfer()
    fireEvent.dragStart(taskRow('A'), { dataTransfer: transfer })
    expect(transfer.effectAllowed).toBe('move')
    fireEvent.dragOver(taskRow('C'), { dataTransfer: transfer })
    expect(transfer.dropEffect).toBe('move')
    expect(taskRow('C').className).toContain('daily-log__task--drag-over')
    fireEvent.drop(taskRow('C'), { dataTransfer: transfer })
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:reorder-tasks')).toEqual([
        { orderedIds: ['b', 'c', 'a'] },
      ])
    )
    expect(props.onRefresh).toHaveBeenCalled()
    expect(taskRow('C').className).not.toContain('drag-over')
  })
}

function dragTestsPart2() {
  it('ignores a drop on itself, a drop with no drag, and finished tasks', async () => {
    renderLog({ log: logOf([task('a', 'A'), task('d', 'D', { status: 'done' })]) })
    expect(taskRow('D').getAttribute('draggable')).not.toBe('true')
    fireEvent.drop(taskRow('A'), { dataTransfer: dataTransfer() })
    fireEvent.dragStart(taskRow('A'), { dataTransfer: dataTransfer() })
    fireEvent.drop(taskRow('A'), { dataTransfer: dataTransfer() })
    fireEvent.dragStart(taskRow('A'), { dataTransfer: dataTransfer() })
    fireEvent.dragEnd(taskRow('A'))
    fireEvent.drop(taskRow('A'), { dataTransfer: dataTransfer() })
    await act(async () => {})
    expect(bridge.calls('task-vault:vault:reorder-tasks')).toEqual([])
  })
}

function staleTests() {
  it('flags an open task rolling over past the threshold, and keeps it on request', async () => {
    const props = renderLog({
      isToday: true,
      staleDaysThreshold: 3,
      log: logOf([
        task('old', 'Old', { todaySince: localDay(-3) }),
        task('new', 'New', { todaySince: localDay(-2) }),
        task('fin', 'Fin', { todaySince: localDay(-9), status: 'done' }),
      ]),
    })
    expect(taskRow('Old').className).toContain('daily-log__task--stale')
    expect(taskRow('New').className).not.toContain('stale')
    expect(taskRow('Fin').className).not.toContain('stale')
    fireEvent.click(screen.getByRole('button', { name: 'keep' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:reset-today-since')).toEqual([{ taskId: 'old' }])
    )
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('flags nothing on another day or without a threshold', () => {
    const log = logOf([task('old', 'Old', { todaySince: '2000-01-01' })])
    renderLog({ isToday: false, staleDaysThreshold: 3, log })
    cleanup()
    renderLog({ isToday: true, log })
    expect(document.querySelector('.daily-log__task--stale')).toBeNull()
  })
}

function backlogTests() {
  it('lists the backlog with its tags, which collapses', () => {
    renderLog({
      somedayTasks: [task('s1', 'Later', { project: 'p', area: 'a', context: 'c' })],
    })
    expect(screen.getByText('Backlog (1)')).toBeTruthy()
    const row = document.querySelector('.daily-log__backlog-task-text')!
    expect(row.textContent).toBe('Later@p#a+c')
    fireEvent.click(screen.getByText('Backlog (1)'))
    expect(document.querySelector('.daily-log__backlog-list')).toBeNull()
  })

  it('says when the backlog is empty', () => {
    renderLog()
    expect(screen.getByText('No backlog items.')).toBeTruthy()
  })
}

function backlogTestsPart2() {
  it('picks up, deletes and selects backlog tasks', () => {
    const onPickUpToday = vi.fn(async () => {})
    const onDeleteBacklogTask = vi.fn(async () => {})
    const onSelectTask = vi.fn()
    renderLog({
      somedayTasks: [task('s1', 'Later')],
      onPickUpToday,
      onDeleteBacklogTask,
      onSelectTask,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick up today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByText('Later'))
    expect(onPickUpToday).toHaveBeenCalledWith('s1')
    expect(onDeleteBacklogTask).toHaveBeenCalledWith('s1')
    expect(onSelectTask).toHaveBeenCalledWith('s1')
  })

  it('offers no actions it was not given', () => {
    renderLog({ somedayTasks: [task('s1', 'Later')] })
    expect(screen.queryByRole('button', { name: 'Pick up today' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(screen.getByText('Later'))
  })
}

function backlogEditTests() {
  it('edits a backlog task from its raw text on double-click', async () => {
    const onRefreshBacklog = vi.fn(async () => {})
    const later = task('s1', 'Later', {
      project: 'big job',
      context: 'c',
      area: 'a',
      dueDate: '2026-02-01',
    })
    renderLog({ somedayTasks: [later], onRefreshBacklog })
    fireEvent.doubleClick(screen.getByText('Later'))
    const input = screen.getByLabelText('Task text') as HTMLInputElement
    expect(input.value).toBe('Later @big-job +c #a due:2026-02-01')
    expect(screen.queryByRole('button', { name: 'Pick up today' })).toBeNull()
    fireEvent.change(input, { target: { value: ' Sooner ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() => expect(onRefreshBacklog).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([{ taskId: 's1', text: 'Sooner' }])
  })
}

function backlogEditTestsPart2() {
  it('reverts a blanked edit, and cancels by button or Escape', async () => {
    renderLog({ somedayTasks: [task('s1', 'Later')] })
    fireEvent.doubleClick(screen.getByText('Later'))
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: '  ' } })
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Enter' })
    await eventually(() => expect(screen.getByText('Later')).toBeTruthy())
    fireEvent.doubleClick(screen.getByText('Later'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }))
    fireEvent.doubleClick(screen.getByText('Later'))
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Escape' })
    expect(screen.getByText('Later')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })
}
