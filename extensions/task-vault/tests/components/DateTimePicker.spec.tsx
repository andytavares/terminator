import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

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
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function clickTrigger(container: HTMLElement): void {
  const trigger = container.querySelector('.dtp__trigger') as HTMLElement
  fireEvent.click(trigger)
}

describe('DateTimePicker — trigger display', () => {
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
})

describe('DateTimePicker — open / close', () => {
  it('opens the popover when trigger is clicked', () => {
    const { container } = render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(screen.getByText('June 2026')).toBeTruthy()
  })

  it('closes the popover when trigger is clicked again', () => {
    const { container } = render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(screen.getByText('June 2026')).toBeTruthy()
    act(() => clickTrigger(container))
    expect(screen.queryByText('June 2026')).toBeNull()
  })

  it('closes on Escape key', () => {
    const { container } = render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(screen.getByText('June 2026')).toBeTruthy()
    act(() => fireEvent.keyDown(document, { key: 'Escape' }))
    expect(screen.queryByText('June 2026')).toBeNull()
  })
})

describe('DateTimePicker — date mode', () => {
  it('shows date shortcut chips', () => {
    const { container } = render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByText('Tomorrow')).toBeTruthy()
    expect(screen.getByText('1 week')).toBeTruthy()
    expect(screen.getByText('2 weeks')).toBeTruthy()
    expect(screen.getByText('Next month')).toBeTruthy()
  })

  it('calls onChange with today when Today chip clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<DateTimePicker mode="date" value="" onChange={onChange} />)
    act(() => clickTrigger(container))
    act(() => fireEvent.click(screen.getByText('Today')))
    expect(onChange).toHaveBeenCalledWith('2026-06-13')
  })

  it('calls onChange with tomorrow when Tomorrow chip clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<DateTimePicker mode="date" value="" onChange={onChange} />)
    act(() => clickTrigger(container))
    act(() => fireEvent.click(screen.getByText('Tomorrow')))
    expect(onChange).toHaveBeenCalledWith('2026-06-14')
  })

  it('navigates to previous month', () => {
    const { container } = render(<DateTimePicker mode="date" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(screen.getByText('June 2026')).toBeTruthy()
    const navButtons = container.querySelectorAll('.dtp__cal-nav')
    act(() => fireEvent.click(navButtons[0]))
    expect(screen.getByText('May 2026')).toBeTruthy()
  })

  it('shows selected day with selected class', () => {
    const { container } = render(
      <DateTimePicker mode="date" value="2026-06-13" onChange={vi.fn()} />
    )
    act(() => clickTrigger(container))
    const selected = container.querySelector('.dtp__cal-day--selected')
    expect(selected).toBeTruthy()
    expect(selected?.textContent).toBe('13')
  })

  it('calls onChange when a calendar day is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateTimePicker mode="date" value="2026-06-01" onChange={onChange} />
    )
    act(() => clickTrigger(container))
    const dayButtons = container.querySelectorAll('.dtp__cal-day:not(.dtp__cal-day--other)')
    const day20 = Array.from(dayButtons).find((b) => b.textContent === '20') as HTMLElement
    act(() => fireEvent.click(day20))
    expect(onChange).toHaveBeenCalledWith('2026-06-20')
  })

  it('Clear button calls onChange with empty string', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateTimePicker mode="date" value="2026-06-13" onChange={onChange} />
    )
    act(() => clickTrigger(container))
    act(() => fireEvent.click(screen.getByText('Clear')))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('min prop disables past dates', () => {
    const { container } = render(
      <DateTimePicker mode="date" value="" onChange={vi.fn()} min="2026-06-13" />
    )
    act(() => clickTrigger(container))
    const disabledDays = container.querySelectorAll('.dtp__cal-day--disabled')
    expect(disabledDays.length).toBeGreaterThan(0)
  })
})

describe('DateTimePicker — time mode (12h + AM/PM toggle)', () => {
  it('shows time shortcut chips', () => {
    const { container } = render(<DateTimePicker mode="time" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(screen.getByText('30 min')).toBeTruthy()
    expect(screen.getByText('1 hour')).toBeTruthy()
    expect(screen.getByText('2 hours')).toBeTruthy()
    expect(screen.getByText('4 hours')).toBeTruthy()
    expect(screen.getByText('End of day')).toBeTruthy()
  })

  it('shows AM/PM toggle buttons', () => {
    const { container } = render(<DateTimePicker mode="time" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(container.querySelector('.dtp__ampm-toggle')).toBeTruthy()
    expect(container.querySelector('.dtp__ampm-btn--active')?.textContent).toBe('AM')
  })

  it('renders time slots in 12h format', () => {
    const { container } = render(<DateTimePicker mode="time" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    // AM slots: 12:00, 12:15 ... visible
    const slots = container.querySelectorAll('.dtp__time-slot')
    expect(slots.length).toBe(48) // 48 slots per half (AM or PM)
    // First AM slot is 12:00 AM → displays as "12:00"
    expect(slots[0]?.textContent).toBe('12:00')
  })

  it('switches to PM slots when PM is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<DateTimePicker mode="time" value="" onChange={onChange} />)
    act(() => clickTrigger(container))
    const pmBtn = Array.from(container.querySelectorAll('.dtp__ampm-btn')).find(
      (b) => b.textContent === 'PM'
    ) as HTMLElement
    act(() => fireEvent.click(pmBtn))
    const slots = container.querySelectorAll('.dtp__time-slot')
    // First PM slot is 12:00 (noon)
    expect(slots[0]?.textContent).toBe('12:00')
    expect(container.querySelector('.dtp__ampm-btn--active')?.textContent).toBe('PM')
  })

  it('calls onChange when a time slot is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<DateTimePicker mode="time" value="" onChange={onChange} />)
    act(() => clickTrigger(container))
    // Switch to PM
    const pmBtn = Array.from(container.querySelectorAll('.dtp__ampm-btn')).find(
      (b) => b.textContent === 'PM'
    ) as HTMLElement
    act(() => fireEvent.click(pmBtn))
    // Find 5:00 slot (17:00 in 24h)
    const slot = Array.from(container.querySelectorAll('.dtp__time-slot')).find(
      (b) => b.textContent === '5:00'
    ) as HTMLElement
    act(() => fireEvent.click(slot))
    expect(onChange).toHaveBeenCalledWith('17:00')
  })

  it('End of day shortcut calls onChange with 17:00', () => {
    const onChange = vi.fn()
    const { container } = render(<DateTimePicker mode="time" value="" onChange={onChange} />)
    act(() => clickTrigger(container))
    act(() => fireEvent.click(screen.getByText('End of day')))
    expect(onChange).toHaveBeenCalledWith('17:00')
  })

  it('shows selected time slot with selected class', () => {
    const { container } = render(<DateTimePicker mode="time" value="14:30" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    // 14:30 is PM, displayed as "2:30"
    const selected = container.querySelector('.dtp__time-slot--selected')
    expect(selected?.textContent).toBe('2:30')
  })

  it('defaults to PM half when selected time is PM', () => {
    const { container } = render(<DateTimePicker mode="time" value="15:00" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(container.querySelector('.dtp__ampm-btn--active')?.textContent).toBe('PM')
  })

  it('applies time-only compact class to popover', () => {
    const { container } = render(<DateTimePicker mode="time" value="" onChange={vi.fn()} />)
    act(() => clickTrigger(container))
    expect(container.querySelector('.dtp__popover--time-only')).toBeTruthy()
  })
})

describe('DateTimePicker — datetime mode', () => {
  it('shows both calendar and time panel with AM/PM toggle', () => {
    const { container } = render(
      <DateTimePicker mode="datetime" value="2026-06-13T14:00" onChange={vi.fn()} />
    )
    act(() => clickTrigger(container))
    expect(screen.getByText('June 2026')).toBeTruthy()
    expect(container.querySelector('.dtp__ampm-toggle')).toBeTruthy()
  })

  it('updates date part when a day is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateTimePicker mode="datetime" value="2026-06-13T14:00" onChange={onChange} />
    )
    act(() => clickTrigger(container))
    const dayButtons = container.querySelectorAll('.dtp__cal-day:not(.dtp__cal-day--other)')
    const day20 = Array.from(dayButtons).find((b) => b.textContent === '20') as HTMLElement
    act(() => fireEvent.click(day20))
    expect(onChange).toHaveBeenCalledWith('2026-06-20T14:00')
  })

  it('updates time part when a slot is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateTimePicker mode="datetime" value="2026-06-13T14:00" onChange={onChange} />
    )
    act(() => clickTrigger(container))
    // 14:00 is PM, so PM tab is active; "4:00" slot = 16:00
    const slot = Array.from(container.querySelectorAll('.dtp__time-slot')).find(
      (b) => b.textContent === '4:00'
    ) as HTMLElement
    act(() => fireEvent.click(slot))
    expect(onChange).toHaveBeenCalledWith('2026-06-13T16:00')
  })
})
