import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installVaultBridge, eventually, task, dayFromToday } from './helpers/bridge'
import { restoreLocalClock, setLocalClock } from '../support/clock'
import { buttonNamed, lastNotice, renderDailyLog } from './helpers/daily-log'

vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))
vi.mock('../../src/components/DateTimePicker', () => import('./helpers/input-stubs'))

import { notify } from '../../src/utils/notify'
import { pressOutside } from '../../../../tests/support/modal'

let bridge: ReturnType<typeof installVaultBridge>

const modal = () => screen.queryByRole('dialog') as HTMLElement

beforeEach(() => {
  setLocalClock('UTC', '2026-01-15T12:00:00.000Z')
  vi.mocked(notify).mockClear()
  bridge = installVaultBridge()
})

afterEach(() => {
  cleanup()
  restoreLocalClock()
})

type User = ReturnType<typeof userEvent.setup>

/** Each way a person closes a dialog without saving. */
const closeWays = [
  { way: 'Cancel', close: (user: User) => user.click(buttonNamed('Cancel')) },
  {
    way: 'the close button',
    close: (user: User) => user.click(within(modal()).getByRole('button', { name: 'Close' })),
  },
  { way: 'a press on the backdrop', close: async () => pressOutside(modal()) },
]

/** Renders a daily log holding `one` and opens the dialog behind the button named `opener`. */
async function openDialog(opener: string, one = task('t1', 'Write')) {
  const user = userEvent.setup()
  const { props } = renderDailyLog(one)
  await user.click(buttonNamed(opener))
  return { user, props }
}

/** Opens the block dialog with a reason typed. */
async function openBlockWithReason() {
  const opened = await openDialog('Mark as blocked')
  await opened.user.type(screen.getByRole('textbox'), 'r')
  return opened
}

/** Clears a field, then types `text` into it. */
async function retype(user: User, field: HTMLElement, text: string) {
  await user.clear(field)
  await user.type(field, text)
}

describe('DailyLog block dialog', blockTests)
describe('DailyLog block dialog closing', blockClosingTests)
describe('DailyLog block check-in', checkInTests)
describe('DailyLog block check-in, continued', checkInTestsPart2)
describe('DailyLog recurrence dialog', recurrenceTests)
describe('DailyLog recurrence dialog, continued', recurrenceTestsPart2)
describe('DailyLog recurrence dialog closing', recurrenceClosingTests)
describe('DailyLog recurrence endings', recurrenceEndTests)
describe('DailyLog recurrence endings, continued', recurrenceEndTestsPart2)
describe('DailyLog recurrence editing', recurrenceEditTests)
describe('DailyLog recurrence editing, continued', recurrenceEditTestsPart2)

function blockTests() {
  it('opens the block dialog with Mark blocked disabled until a reason is typed', async () => {
    await openDialog('Mark as blocked')
    expect(screen.getByText('Mark as Blocked')).toBeTruthy()
    expect(buttonNamed('Mark blocked')).toHaveProperty('disabled', true)
  })

  it('blocks with the trimmed reason and the chosen check-in, then closes', async () => {
    const { user, props } = await openDialog('Mark as blocked')
    await user.type(screen.getByRole('textbox'), ' waiting ')
    await user.click(buttonNamed('1 week'))
    expect(buttonNamed('1 week').className).toContain('--active')
    await user.click(buttonNamed('Mark blocked'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:block-task')).toEqual([
      { taskId: 't1', reason: 'waiting', checkInterval: '1-week' },
    ])
    expect(lastNotice()?.slice(0, 2)).toEqual(['warning', 'Blocked: Write'])
    expect(modal()).toBeNull()
  })
}

function blockClosingTests() {
  it.each(closeWays)('closes the block dialog by $way without blocking', async ({ close }) => {
    const { user } = await openDialog('Mark as blocked')
    await close(user)
    expect(modal()).toBeNull()
    expect(bridge.calls('task-vault:vault:block-task')).toEqual([])
  })

  it('keeps the block dialog open on a click inside it', async () => {
    const { user } = await openDialog('Mark as blocked')
    await user.click(modal())
    expect(modal()).toBeTruthy()
  })
}

function checkInTests() {
  it('offers a custom check-in from tomorrow, no earlier than today', async () => {
    const { user } = await openBlockWithReason()
    await user.click(buttonNamed('Custom…'))
    expect(buttonNamed('Custom…').className).toContain('--active')
    const date = screen.getByLabelText('date picker')
    expect(date).toHaveProperty('value', dayFromToday(1))
    expect(date.dataset.min).toBe(dayFromToday())
  })

  it('checks in at a custom date and time', async () => {
    const { user } = await openBlockWithReason()
    await user.click(buttonNamed('Custom…'))
    await retype(user, screen.getByLabelText('date picker'), '2026-05-05')
    await retype(user, screen.getByLabelText('time picker'), '14:30')
    await user.click(buttonNamed('Mark blocked'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:block-task')).toEqual([
        { taskId: 't1', reason: 'r', checkInterval: '2026-05-05T14:30' },
      ])
    )
  })
}

function checkInTestsPart2() {
  it('goes back to a quick interval from a custom one', async () => {
    const { user } = await openBlockWithReason()
    await user.click(buttonNamed('Custom…'))
    await user.click(buttonNamed('30 min'))
    expect(screen.queryByLabelText('date picker')).toBeNull()
    await user.click(buttonNamed('Mark blocked'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:block-task')).toEqual([
        { taskId: 't1', reason: 'r', checkInterval: '30-min' },
      ])
    )
  })
}

function recurrenceTests() {
  it('opens a new recurrence with no Remove button and a nine o’clock time', async () => {
    await openDialog('Set recurrence')
    expect(screen.getByText('Set Recurrence')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.getByLabelText('time picker')).toHaveProperty('value', '09:00')
  })

  it('sets a weekly recurrence on the chosen days', async () => {
    const { user, props } = await openDialog('Set recurrence')
    await user.click(buttonNamed('Mon'))
    await user.click(buttonNamed('Sat'))
    expect(buttonNamed('Sat').className).toContain('--active')
    await user.click(buttonNamed('Save'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:set-recurrence')).toEqual([
      { taskId: 't1', interval: 'weekly', days: [3, 5, 6], time: '09:00', endType: 'none' },
    ])
    expect(lastNotice()?.slice(0, 2)).toEqual(['success', 'Recurrence set: Weekly · Wed, Fri, Sat'])
  })
}

function recurrenceTestsPart2() {
  it('keeps Save disabled for a weekly rule with no day', async () => {
    const { user } = await openDialog('Set recurrence')
    await user.click(buttonNamed('Mon'))
    await user.click(buttonNamed('Wed'))
    await user.click(buttonNamed('Fri'))
    expect(buttonNamed('Save')).toHaveProperty('disabled', true)
  })

  it('drops the days and an emptied time for a daily rule', async () => {
    const { user } = await openDialog('Set recurrence')
    await user.click(buttonNamed('Daily'))
    expect(screen.queryByRole('button', { name: 'Mon' })).toBeNull()
    await user.clear(screen.getByLabelText('time picker'))
    await user.click(buttonNamed('Save'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:set-recurrence')).toEqual([
        { taskId: 't1', interval: 'daily', endType: 'none' },
      ])
    )
    expect(lastNotice()?.[1]).toBe('Recurrence set: Daily')
  })
}

function recurrenceClosingTests() {
  it.each(closeWays)('closes the recurrence dialog by $way without saving', async ({ close }) => {
    const { user } = await openDialog('Set recurrence')
    await close(user)
    expect(modal()).toBeNull()
    expect(bridge.calls('task-vault:vault:set-recurrence')).toEqual([])
  })
}

function recurrenceEndTests() {
  it('keeps Save disabled for an end on a date until the date is given', async () => {
    const { user } = await openDialog('Set recurrence')
    await user.click(buttonNamed('Monthly'))
    await user.click(buttonNamed('On date'))
    expect(buttonNamed('Save')).toHaveProperty('disabled', true)
  })

  it('ends on the given date', async () => {
    const { user } = await openDialog('Set recurrence')
    await user.click(buttonNamed('Monthly'))
    await user.click(buttonNamed('On date'))
    await user.type(screen.getByLabelText('date picker'), '2026-12-31')
    await user.click(buttonNamed('Save'))
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
  it('starts an end count at ten and raises a count below one to one', async () => {
    const { user } = await openDialog('Set recurrence')
    await user.click(buttonNamed('After'))
    const count = screen.getByRole('spinbutton')
    expect(count).toHaveProperty('value', '10')
    await user.tripleClick(count)
    await user.keyboard('0')
    expect(count).toHaveProperty('value', '1')
  })

  it('ends after the count, kept across a switch to Never and back', async () => {
    const { user } = await openDialog('Set recurrence')
    await user.click(buttonNamed('Every 2 weeks'))
    await user.click(buttonNamed('After'))
    await user.tripleClick(screen.getByRole('spinbutton'))
    await user.keyboard('4')
    await user.click(buttonNamed('Never'))
    await user.click(buttonNamed('After'))
    await user.click(buttonNamed('Save'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:set-recurrence')).toEqual([
        { taskId: 't1', interval: 'biweekly', time: '09:00', endType: 'after_count', endCount: 4 },
      ])
    )
  })
}

function recurrenceEditTests() {
  it('edits an existing weekly rule from its saved values', async () => {
    const weekly = task('t1', 'Write', {
      recurrenceRule: 'weekly:2,4',
      recurrenceNotifyAt: '07:15',
      recurrenceEndType: 'after_count',
      recurrenceEndCount: 3,
    })
    await openDialog('Recurrence: Weekly · Tue, Thu', weekly)
    expect(screen.getByText('Edit Recurrence')).toBeTruthy()
    expect(buttonNamed('Tue').className).toContain('--active')
    expect(buttonNamed('Mon').className).not.toContain('--active')
    expect(screen.getByLabelText('time picker')).toHaveProperty('value', '07:15')
    expect(screen.getByRole('spinbutton')).toHaveProperty('value', '3')
  })
}

const monthlyUntil2027 = () =>
  task('t1', 'Write', {
    recurrenceRule: 'monthly',
    recurrenceEndType: 'on_date',
    recurrenceEndDate: '2027-01-01',
  })

function recurrenceEditTestsPart2() {
  it('edits an existing monthly rule with its saved end date', async () => {
    await openDialog('Recurrence: Monthly', monthlyUntil2027())
    expect(buttonNamed('Monthly').className).toContain('--active')
    expect(screen.getByLabelText('date picker')).toHaveProperty('value', '2027-01-01')
  })

  it('removes an existing rule and closes', async () => {
    const { user, props } = await openDialog('Recurrence: Monthly', monthlyUntil2027())
    await user.click(buttonNamed('Remove'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:clear-recurrence')).toEqual([{ taskId: 't1' }])
    expect(lastNotice()).toEqual(['info', 'Recurrence removed: Write', 'recurrenceRemoved'])
    expect(modal()).toBeNull()
  })
}
