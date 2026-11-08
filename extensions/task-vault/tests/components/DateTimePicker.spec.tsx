import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>()
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

import { DateTimePicker } from '../../src/components/DateTimePicker'

// 10:00 AM → AM half is the default
const FIXED_NOW = new Date('2026-06-13T10:00:00')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const trigger = () => document.querySelector('.dtp__trigger') as HTMLElement
const monthLabel = () => document.querySelector('.dtp__cal-month-label')?.textContent
const chipLabels = () => Array.from(document.querySelectorAll('.dtp__chip'), (c) => c.textContent)

describe('DateTimePicker — trigger display', dateTimePickerTriggerDisplayTests)

describe('DateTimePicker — open / close', () => {
  it('opens the popover when trigger is clicked', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(monthLabel()).toBe('June 2026')
  })

  it('closes the popover when trigger is clicked again', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    await user.click(trigger())
    expect(screen.queryByText('June 2026')).toBeNull()
  })

  it('closes on Escape key', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(document.querySelector('.dtp__popover')?.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByText('June 2026')).toBeNull()
  })
})

describe('DateTimePicker — date mode', dateTimePickerDateModeTests)
describe('DateTimePicker — time mode (12h + AM/PM toggle)', dateTimePickerTimeMode12hAMTests)
describe('DateTimePicker — datetime mode', dateTimePickerDatetimeModeTests)

function dateTimePickerTriggerDisplayTests() {
  describe('placeholders', dateTimePickerTriggerDisplayPlaceholdersTests)
  describe('values', dateTimePickerTriggerDisplayValuesTests)
}

function dateTimePickerTriggerDisplayPlaceholdersTests() {
  it('renders placeholder when value is empty (date mode)', () => {
    const { container } = render(
      <DateTimePicker mode="date" value="" onChange={vi.fn()} placeholder="Pick a date" />
    )
    expect(container.querySelector('.dtp__trigger-label')?.textContent).toBe('Pick a date')
  })

  it('renders placeholder when value is empty (time mode)', () => {
    const { container } = render(
      <DateTimePicker mode="time" value="" onChange={vi.fn()} placeholder="Pick a time" />
    )
    expect(container.querySelector('.dtp__trigger-label')?.textContent).toBe('Pick a time')
  })
}

function dateTimePickerTriggerDisplayValuesTests() {
  it('renders formatted date when value is provided', () => {
    const { container } = render(
      <DateTimePicker mode="date" value="2026-06-13" onChange={vi.fn()} />
    )
    const label = container.querySelector('.dtp__trigger-label')?.textContent ?? ''
    expect(label).toContain('Jun')
    expect(label).toContain('2026')
  })

  it('renders 12h formatted time when value is provided', () => {
    const { container } = render(<DateTimePicker mode="time" value="14:30" onChange={vi.fn()} />)
    expect(container.querySelector('.dtp__trigger-label')?.textContent).toContain('2:30 PM')
  })

  it('renders AM time correctly', () => {
    const { container } = render(<DateTimePicker mode="time" value="09:15" onChange={vi.fn()} />)
    expect(container.querySelector('.dtp__trigger-label')?.textContent).toContain('9:15 AM')
  })
}

function dateTimePickerDateModeTests() {
  describe('shortcuts', dateTimePickerDateModeShortcutsTests)
  describe('calendar', dateTimePickerDateModeCalendarTests)
  describe('clearing and limits', dateTimePickerDateModeClearingLimitsTests)
}

function dateTimePickerDateModeShortcutsTests() {
  it('shows date shortcut chips', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(chipLabels()).toEqual(['Today', 'Tomorrow', '1 week', '2 weeks', 'Next month'])
  })

  it.each([
    ['Today', '2026-06-13'],
    ['Tomorrow', '2026-06-14'],
  ])('calls onChange with the date of the %s chip', async (chip, date) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateTimePicker mode="date" value="" onChange={onChange} />)
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: chip }))
    expect(onChange).toHaveBeenCalledWith(date)
  })
}

function dateTimePickerDateModeCalendarTests() {
  describe('navigation', dateTimePickerDateModeCalendarNavigationTests)
  describe('days', dateTimePickerDateModeCalendarDaysTests)
}

function dateTimePickerDateModeCalendarNavigationTests() {
  it('navigates to previous month', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(monthLabel()).toBe('June 2026')
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(monthLabel()).toBe('May 2026')
  })
}

function dateTimePickerDateModeCalendarDaysTests() {
  it('shows selected day with selected class', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <DateTimePicker mode="date" value="2026-06-13" onChange={vi.fn()} />
    )
    await user.click(trigger())
    expect(container.querySelector('.dtp__cal-day--selected')?.textContent).toBe('13')
  })

  it('calls onChange when a calendar day is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateTimePicker mode="date" value="2026-06-01" onChange={onChange} />)
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: '20' }))
    expect(onChange).toHaveBeenCalledWith('2026-06-20')
  })
}

function dateTimePickerDateModeClearingLimitsTests() {
  it('Clear button calls onChange with empty string', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateTimePicker mode="date" value="2026-06-13" onChange={onChange} />)
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('min prop disables past dates', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="date" value="" onChange={vi.fn()} min="2026-06-13" />)
    await user.click(trigger())
    expect(screen.getByRole('button', { name: '12' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '13' })).toHaveProperty('disabled', false)
  })
}

function dateTimePickerTimeMode12hAMTests() {
  describe('shortcuts and halves', dateTimePickerTimeMode12hAMShortcutsHalvesTests)
  describe('slots', dateTimePickerTimeMode12hAMSlotsTests)
  describe('selection', dateTimePickerTimeMode12hAMSelectionTests)
}

function dateTimePickerTimeMode12hAMShortcutsHalvesTests() {
  it('shows time shortcut chips', async () => {
    const user = userEvent.setup()
    render(<DateTimePicker mode="time" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(chipLabels()).toEqual(['30 min', '1 hour', '2 hours', '4 hours', 'End of day'])
  })
}

function dateTimePickerTimeMode12hAMSlotsTests() {
  describe('halves', dateTimePickerTimeMode12hAMSlotsHalvesTests)
  describe('choosing', dateTimePickerTimeMode12hAMSlotsChoosingTests)
}

function dateTimePickerTimeMode12hAMSlotsHalvesTests() {
  it('renders time slots in 12h format', async () => {
    const user = userEvent.setup()
    const { container } = render(<DateTimePicker mode="time" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    const slots = container.querySelectorAll('.dtp__time-slot')
    expect(slots.length).toBe(48) // 48 slots per half (AM or PM)
    // First AM slot is 12:00 AM → displays as "12:00"
    expect(slots[0]?.textContent).toBe('12:00')
  })

  it('switches to PM slots when PM is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(<DateTimePicker mode="time" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'PM' }))
    // First PM slot is 12:00 (noon)
    expect(container.querySelector('.dtp__time-slot')?.textContent).toBe('12:00')
    expect(container.querySelector('.dtp__ampm-btn--active')?.textContent).toBe('PM')
  })
}

function dateTimePickerTimeMode12hAMSlotsChoosingTests() {
  it('calls onChange when a time slot is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateTimePicker mode="time" value="" onChange={onChange} />)
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'PM' }))
    await user.click(screen.getByRole('button', { name: '5:00' }))
    expect(onChange).toHaveBeenCalledWith('17:00')
  })
}

function dateTimePickerTimeMode12hAMSelectionTests() {
  it('End of day shortcut calls onChange with 17:00', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateTimePicker mode="time" value="" onChange={onChange} />)
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'End of day' }))
    expect(onChange).toHaveBeenCalledWith('17:00')
  })

  it('shows selected time slot with selected class', async () => {
    const user = userEvent.setup()
    const { container } = render(<DateTimePicker mode="time" value="14:30" onChange={vi.fn()} />)
    await user.click(trigger())
    // 14:30 is PM, displayed as "2:30"
    expect(container.querySelector('.dtp__time-slot--selected')?.textContent).toBe('2:30')
  })

  it('defaults to PM half when selected time is PM', async () => {
    const user = userEvent.setup()
    const { container } = render(<DateTimePicker mode="time" value="15:00" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(container.querySelector('.dtp__ampm-btn--active')?.textContent).toBe('PM')
  })

  it('applies time-only compact class to popover', async () => {
    const user = userEvent.setup()
    const { container } = render(<DateTimePicker mode="time" value="" onChange={vi.fn()} />)
    await user.click(trigger())
    expect(container.querySelector('.dtp__popover')?.className).toContain('dtp__popover--time-only')
  })
}

function dateTimePickerDatetimeModeTests() {
  describe('updates', dateTimePickerDatetimeModeUpdatesTests)
}

function dateTimePickerDatetimeModeUpdatesTests() {
  it('updates date part when a day is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateTimePicker mode="datetime" value="2026-06-13T14:00" onChange={onChange} />)
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: '20' }))
    expect(onChange).toHaveBeenCalledWith('2026-06-20T14:00')
  })

  it('updates time part when a slot is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateTimePicker mode="datetime" value="2026-06-13T14:00" onChange={onChange} />)
    await user.click(trigger())
    // 14:00 is PM, so PM tab is active; "4:00" slot = 16:00
    await user.click(screen.getByRole('button', { name: '4:00' }))
    expect(onChange).toHaveBeenCalledWith('2026-06-13T16:00')
  })
}
