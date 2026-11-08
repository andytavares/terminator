import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateTimePicker, type DateTimePickerProps } from '../../src/components/DateTimePicker'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-20T15:05:00'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderOpen(props: Partial<DateTimePickerProps> & Pick<DateTimePickerProps, 'mode'>) {
  const onChange = vi.fn()
  const utils = render(<DateTimePicker value="" onChange={onChange} defaultOpen {...props} />)
  return { onChange, ...utils }
}

const trigger = (open = false) => screen.getByRole('button', { expanded: open })
const popover = () => screen.queryByRole('group', { name: /^Pick/ })
const calendar = () => within(screen.getByRole('group', { name: 'Calendar' }))
const halfPressed = (half: 'AM' | 'PM') =>
  screen.getByRole('button', { name: half }).getAttribute('aria-pressed')

describe('DateTimePicker halves and shortcuts', halvesTests)
describe('DateTimePicker months and closing', monthsTests)

function halvesTests() {
  describe('halves', halvesHalvesTests)
  describe('shortcuts', halvesShortcutsAndLabelsTests)
  describe('labels', halvesLabelsTests)
}

function halvesHalvesTests() {
  it('mirrors a picked time into the PM half in time mode', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOpen({ mode: 'time', value: '09:30' })
    await user.click(screen.getByRole('button', { name: 'PM' }))
    expect(onChange).toHaveBeenCalledWith('21:30')
  })

  it('mirrors a picked time into the AM half in datetime mode', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOpen({ mode: 'datetime', value: '2026-12-01T21:15' })
    await user.click(screen.getByRole('button', { name: 'AM' }))
    expect(onChange).toHaveBeenCalledWith('2026-12-01T09:15')
  })

  it('switches halves without a change when no time is set, starting on the current half', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOpen({ mode: 'time' })
    expect(halfPressed('PM')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'AM' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(halfPressed('AM')).toBe('true')
    expect(halfPressed('PM')).toBe('false')
  })
}

function halvesShortcutsAndLabelsTests() {
  it('applies a time shortcut, rounded to the next quarter hour, and closes', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOpen({ mode: 'time' })
    await user.click(screen.getByRole('button', { name: '30 min' }))
    expect(onChange).toHaveBeenCalledWith('15:45')
    expect(popover()).toBeNull()
  })

  it('keeps the time when a date shortcut is used in datetime mode', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOpen({ mode: 'datetime', value: '2026-12-01T08:00' })
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(onChange).toHaveBeenCalledWith('2026-12-21T08:00')
  })

  it('uses noon when a date shortcut is used in datetime mode with no time', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOpen({ mode: 'datetime' })
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenCalledWith('2026-12-20T12:00')
  })

  it('picks a time slot on today when datetime mode has no date', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOpen({ mode: 'datetime' })
    await user.click(screen.getByRole('button', { name: '3:00' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-12-20T15:00')
  })
}

function halvesLabelsTests() {
  it('labels a datetime value with both parts, and a date-only one', () => {
    render(<DateTimePicker mode="datetime" value="2026-12-01T13:05" onChange={vi.fn()} />)
    expect(trigger().textContent).toBe('Dec 1, 2026  1:05 PM')
    cleanup()
    render(<DateTimePicker mode="datetime" value="2026-12-01" onChange={vi.fn()} />)
    expect(trigger().textContent).toBe('Dec 1, 2026  ')
    cleanup()
    render(<DateTimePicker mode="datetime" value="" onChange={vi.fn()} />)
    expect(trigger().textContent).toBe('Pick date & time')
  })
}

function monthsTests() {
  describe('months', monthsMonthsTests)
  describe('closing', monthsClosingTests)
}

function monthsMonthsTests() {
  it('wraps the year forward from December', async () => {
    const user = userEvent.setup()
    renderOpen({ mode: 'date' })
    expect(screen.getByText('December 2026')).toBeTruthy()
    await user.click(calendar().getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('January 2027')).toBeTruthy()
  })

  it('wraps the year back from January', async () => {
    const user = userEvent.setup()
    renderOpen({ mode: 'date', value: '2027-01-10' })
    await user.click(calendar().getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText('December 2026')).toBeTruthy()
  })

  it('re-anchors the calendar when the value changes from outside', () => {
    const { rerender, onChange } = renderOpen({ mode: 'date' })
    rerender(<DateTimePicker mode="date" value="2025-03-04" onChange={onChange} defaultOpen />)
    expect(screen.getByText('March 2025')).toBeTruthy()
  })
}

function monthsClosingTests() {
  it('closes on Done', async () => {
    const user = userEvent.setup()
    renderOpen({ mode: 'date' })
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(popover()).toBeNull()
  })

  it('opens and closes with the trigger', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(popover()).not.toBeNull()
    await user.click(trigger(true))
    expect(popover()).toBeNull()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(popover()?.matches(':focus-within')).toBe(true)
    await user.keyboard('{Escape}')
    expect(popover()).toBeNull()
  })
}
