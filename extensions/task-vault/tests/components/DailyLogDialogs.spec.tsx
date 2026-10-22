import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, fireEvent, within } from '@testing-library/react'
import { installVaultBridge, eventually, task, dayFromToday } from './helpers/bridge'
import { buttonNamed, lastNotice, renderDailyLog } from './helpers/daily-log'

vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))
vi.mock('../../src/components/DateTimePicker', () => import('./helpers/input-stubs'))

import { notify } from '../../src/utils/notify'
import { pressOutside } from '../../../../tests/support/modal'

let bridge: ReturnType<typeof installVaultBridge>

const modal = () => document.querySelector('.daily-log__block-modal') as HTMLElement

beforeEach(() => {
  vi.mocked(notify).mockClear()
  bridge = installVaultBridge()
})

afterEach(() => cleanup())

describe('DailyLog block dialog', blockTests)
describe('DailyLog block dialog, continued', blockTestsPart2)
describe('DailyLog block check-in', checkInTests)
describe('DailyLog block check-in, continued', checkInTestsPart2)
describe('DailyLog recurrence dialog', recurrenceTests)
describe('DailyLog recurrence dialog, continued', recurrenceTestsPart2)
describe('DailyLog recurrence endings', recurrenceEndTests)
describe('DailyLog recurrence endings, continued', recurrenceEndTestsPart2)
describe('DailyLog recurrence editing', recurrenceEditTests)
describe('DailyLog recurrence editing, continued', recurrenceEditTestsPart2)

function blockTests() {
  it('blocks with a reason and a check-in', async () => {
    const { props } = renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Mark as blocked'))
    expect(screen.getByText('Mark as Blocked')).toBeTruthy()
    expect(buttonNamed('Mark blocked')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' waiting ' } })
    fireEvent.click(buttonNamed('1 week'))
    expect(buttonNamed('1 week').className).toContain('--active')
    fireEvent.click(buttonNamed('Mark blocked'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:block-task')).toEqual([
      { taskId: 't1', reason: 'waiting', checkInterval: '1-week' },
    ])
    expect(lastNotice()?.slice(0, 2)).toEqual(['warning', 'Blocked: Write'])
    expect(modal()).toBeNull()
  })
}

function blockTestsPart2() {
  it('closes by Cancel, the close button or the backdrop, but not a click inside', () => {
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Mark as blocked'))
    fireEvent.click(buttonNamed('Cancel'))
    fireEvent.click(buttonNamed('Mark as blocked'))
    fireEvent.click(within(modal()).getByRole('button', { name: 'Close' }))
    fireEvent.click(buttonNamed('Mark as blocked'))
    fireEvent.click(modal())
    expect(modal()).toBeTruthy()
    pressOutside(modal())
    expect(modal()).toBeNull()
    expect(bridge.calls('task-vault:vault:block-task')).toEqual([])
  })
}

function checkInTests() {
  it('checks in at a custom date and time, from tomorrow at nine', async () => {
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Mark as blocked'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'r' } })
    fireEvent.click(buttonNamed('Custom…'))
    expect(buttonNamed('Custom…').className).toContain('--active')
    const date = screen.getByLabelText('date picker') as HTMLInputElement
    expect(date.value).toBe(dayFromToday(1))
    expect(date.dataset.min).toBe(dayFromToday())
    fireEvent.change(date, { target: { value: '2026-05-05' } })
    fireEvent.change(screen.getByLabelText('time picker'), { target: { value: '14:30' } })
    fireEvent.click(buttonNamed('Mark blocked'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:block-task')).toEqual([
        { taskId: 't1', reason: 'r', checkInterval: '2026-05-05T14:30' },
      ])
    )
  })
}

function checkInTestsPart2() {
  it('goes back to a quick interval from a custom one', async () => {
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Mark as blocked'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'r' } })
    fireEvent.click(buttonNamed('Custom…'))
    fireEvent.click(buttonNamed('30 min'))
    expect(screen.queryByLabelText('date picker')).toBeNull()
    fireEvent.click(buttonNamed('Mark blocked'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:block-task')).toEqual([
        { taskId: 't1', reason: 'r', checkInterval: '30-min' },
      ])
    )
  })
}

function recurrenceTests() {
  it('sets a weekly recurrence on chosen days', async () => {
    const { props } = renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Set recurrence'))
    expect(screen.getByText('Set Recurrence')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect((screen.getByLabelText('time picker') as HTMLInputElement).value).toBe('09:00')
    fireEvent.click(buttonNamed('Mon'))
    fireEvent.click(buttonNamed('Sat'))
    expect(buttonNamed('Sat').className).toContain('--active')
    fireEvent.click(buttonNamed('Save'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:set-recurrence')).toEqual([
      { taskId: 't1', interval: 'weekly', days: [3, 5, 6], time: '09:00', endType: 'none' },
    ])
    expect(lastNotice()?.slice(0, 2)).toEqual(['success', 'Recurrence set: Weekly · Wed, Fri, Sat'])
  })
}

function recurrenceTestsPart2() {
  it('needs a day for a weekly rule, and drops days and time for a daily one', async () => {
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Set recurrence'))
    for (const day of ['Mon', 'Wed', 'Fri']) fireEvent.click(buttonNamed(day))
    expect(buttonNamed('Save')).toHaveProperty('disabled', true)
    fireEvent.click(buttonNamed('Daily'))
    expect(screen.queryByRole('button', { name: 'Mon' })).toBeNull()
    fireEvent.change(screen.getByLabelText('time picker'), { target: { value: '' } })
    fireEvent.click(buttonNamed('Save'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:set-recurrence')).toEqual([
        { taskId: 't1', interval: 'daily', endType: 'none' },
      ])
    )
    expect(lastNotice()?.[1]).toBe('Recurrence set: Daily')
  })

  it('closes by Cancel, the close button or the backdrop', () => {
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Set recurrence'))
    fireEvent.click(buttonNamed('Cancel'))
    fireEvent.click(buttonNamed('Set recurrence'))
    fireEvent.click(within(modal()).getByRole('button', { name: 'Close' }))
    fireEvent.click(buttonNamed('Set recurrence'))
    fireEvent.click(modal())
    pressOutside(modal())
    expect(modal()).toBeNull()
  })
}

function recurrenceEndTests() {
  it('ends on a date, which it needs before saving', async () => {
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Set recurrence'))
    fireEvent.click(buttonNamed('Monthly'))
    fireEvent.click(buttonNamed('On date'))
    expect(buttonNamed('Save')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('date picker'), { target: { value: '2026-12-31' } })
    fireEvent.click(buttonNamed('Save'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:set-recurrence')).toEqual([
        {
          taskId: 't1',
          interval: 'monthly',
          time: '09:00',
          endType: 'on_date',
          endDate: '2026-12-31',
        },
      ])
    )
  })
}

function recurrenceEndTestsPart2() {
  it('ends after a count of at least one', async () => {
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Set recurrence'))
    fireEvent.click(buttonNamed('Every 2 weeks'))
    fireEvent.click(buttonNamed('After'))
    const count = screen.getByRole('spinbutton') as HTMLInputElement
    expect(count.value).toBe('10')
    fireEvent.change(count, { target: { value: '0' } })
    expect(count.value).toBe('1')
    fireEvent.change(count, { target: { value: '4' } })
    fireEvent.click(buttonNamed('Never'))
    fireEvent.click(buttonNamed('After'))
    fireEvent.click(buttonNamed('Save'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:set-recurrence')).toEqual([
        { taskId: 't1', interval: 'biweekly', time: '09:00', endType: 'after_count', endCount: 4 },
      ])
    )
  })
}

function recurrenceEditTests() {
  it('edits an existing weekly rule from its saved values', () => {
    renderDailyLog(
      task('t1', 'Write', {
        recurrenceRule: 'weekly:2,4',
        recurrenceNotifyAt: '07:15',
        recurrenceEndType: 'after_count',
        recurrenceEndCount: 3,
      })
    )
    fireEvent.click(buttonNamed('Recurrence: Weekly · Tue, Thu'))
    expect(screen.getByText('Edit Recurrence')).toBeTruthy()
    expect(buttonNamed('Tue').className).toContain('--active')
    expect(buttonNamed('Mon').className).not.toContain('--active')
    expect((screen.getByLabelText('time picker') as HTMLInputElement).value).toBe('07:15')
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('3')
  })
}

function recurrenceEditTestsPart2() {
  it('removes an existing rule', async () => {
    const { props } = renderDailyLog(
      task('t1', 'Write', {
        recurrenceRule: 'monthly',
        recurrenceEndType: 'on_date',
        recurrenceEndDate: '2027-01-01',
      })
    )
    fireEvent.click(buttonNamed('Recurrence: Monthly'))
    expect(buttonNamed('Monthly').className).toContain('--active')
    expect((screen.getByLabelText('date picker') as HTMLInputElement).value).toBe('2027-01-01')
    fireEvent.click(buttonNamed('Remove'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:clear-recurrence')).toEqual([{ taskId: 't1' }])
    expect(lastNotice()).toEqual(['info', 'Recurrence removed: Write', 'recurrenceRemoved'])
    expect(modal()).toBeNull()
  })
}
