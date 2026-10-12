import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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

const label = () => document.querySelector('.dtp__cal-month-label')?.textContent
const trigger = () => document.querySelector('.dtp__trigger') as HTMLElement
const popover = () => document.querySelector('.dtp__popover')

describe('DateTimePicker halves and shortcuts', halvesTests)
describe('DateTimePicker months and closing', monthsTests)

function halvesTests() {
  describe('halves', halvesHalvesTests)
  describe('shortcuts and labels', halvesShortcutsAndLabelsTests)
}

function halvesHalvesTests() {
  it('mirrors a picked time into the other half of the day', () => {
    const { onChange } = renderOpen({ mode: 'time', value: '09:30' })
    fireEvent.click(screen.getByText('PM'))
    expect(onChange).toHaveBeenCalledWith('21:30')
    const datetime = renderOpen({ mode: 'datetime', value: '2026-12-01T21:15' })
    fireEvent.click(screen.getAllByText('AM')[1])
    expect(datetime.onChange).toHaveBeenCalledWith('2026-12-01T09:15')
  })

  it('switches halves without a change when no time is set, starting on the current half', () => {
    const { onChange } = renderOpen({ mode: 'time' })
    expect(document.querySelector('.dtp__ampm-btn--active')?.textContent).toBe('PM')
    fireEvent.click(screen.getByText('AM'))
    expect(onChange).not.toHaveBeenCalled()
    expect(document.querySelector('.dtp__ampm-btn--active')?.textContent).toBe('AM')
  })
}

function halvesShortcutsAndLabelsTests() {
  it('applies a time shortcut, rounded to the next quarter hour', () => {
    const { onChange } = renderOpen({ mode: 'time' })
    fireEvent.click(screen.getByText('30 min'))
    expect(onChange).toHaveBeenCalledWith('15:45')
    expect(popover()).toBeNull()
  })

  it('keeps the time when a date shortcut is used in datetime mode, or uses noon', () => {
    const { onChange } = renderOpen({ mode: 'datetime', value: '2026-12-01T08:00' })
    fireEvent.click(screen.getByText('Tomorrow'))
    expect(onChange).toHaveBeenCalledWith('2026-12-21T08:00')
    cleanup()
    const empty = renderOpen({ mode: 'datetime' })
    fireEvent.click(screen.getByText('Today'))
    expect(empty.onChange).toHaveBeenCalledWith('2026-12-20T12:00')
    fireEvent.click(screen.getByText('3:00'))
    expect(empty.onChange).toHaveBeenLastCalledWith('2026-12-20T15:00')
  })

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
  it('wraps the year forward from December and back from January', () => {
    renderOpen({ mode: 'date' })
    expect(label()).toBe('December 2026')
    fireEvent.click(document.querySelector('.dtp__cal-header button:last-child') as HTMLElement)
    expect(label()).toBe('January 2027')
    fireEvent.click(document.querySelector('.dtp__cal-header button') as HTMLElement)
    fireEvent.click(document.querySelector('.dtp__cal-header button') as HTMLElement)
    expect(label()).toBe('November 2026')
  })

  it('re-anchors the calendar when the value changes from outside', () => {
    const { rerender, onChange } = renderOpen({ mode: 'date' })
    rerender(<DateTimePicker mode="date" value="2025-03-04" onChange={onChange} defaultOpen />)
    expect(label()).toBe('March 2025')
  })
}

function monthsClosingTests() {
  it('closes with Done or the trigger, and opens above the trigger when space is short', () => {
    renderOpen({ mode: 'date' })
    fireEvent.click(screen.getByText('Done'))
    expect(popover()).toBeNull()
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({
      top: 700,
      bottom: 720,
      left: 10,
    } as DOMRect)
    fireEvent.click(trigger())
    expect((popover() as HTMLElement).style.top).toBe(`${700 - 360 - 4}px`)
    fireEvent.click(trigger())
    expect(popover()).toBeNull()
  })
}
