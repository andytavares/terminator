import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { installVaultBridge, eventually } from './helpers/bridge'

const store = {
  loadDate: vi.fn(),
  loadToday: vi.fn(),
  calendarRefreshKey: 0,
}
vi.mock('../../src/stores/vault.store', () => ({ useVaultStore: () => store }))

import { CalendarDrawer, statusDotClass } from '../../src/components/CalendarDrawer'

let bridge: ReturnType<typeof installVaultBridge>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 0, 15, 12))
  bridge = installVaultBridge()
  bridge.responses['task-vault:vault:get-calendar-month'] = (payload: unknown) => {
    const { month } = payload as { month: number }
    if (month !== 1) return { days: [] }
    return {
      days: [
        { date: '2026-01-10', status: 'open', count: 2 },
        { date: '2026-01-10', status: 'done', count: 1 },
        { date: '2026-01-20', status: 'done', count: 1 },
      ],
    }
  }
  bridge.responses['task-vault:vault:get-daily'] = (payload: unknown) => {
    const { date } = payload as { date: string }
    if (date === '2026-01-10')
      return { tasks: [{ id: 'x', text: 'Late', status: 'open', dueDate: '2026-01-09' }] }
    if (date === '2026-01-11') throw new Error('offline')
    return { tasks: [] }
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

const monthLabel = () => document.querySelector('.cal-drawer__month-label')?.textContent

describe('CalendarDrawer months', monthTests)
describe('CalendarDrawer days', dayTests)

function monthTests() {
  it('wraps the year going back from January and forward from December', async () => {
    render(<CalendarDrawer />)
    expect(monthLabel()).toBe('January 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(monthLabel()).toBe('December 2025')
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(monthLabel()).toBe('February 2026')
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-calendar-month')).toContainEqual({
        year: 2025,
        month: 12,
      })
    )
  })

  it('marks overdue days and colours dots by status', async () => {
    render(<CalendarDrawer />)
    const late = await screen.findByRole('button', { name: '2026-01-10 · 1 of 2 still open' })
    expect(late.className).toContain('cal-drawer__cell--overdue')
    const done = screen.getByRole('button', { name: '2026-01-20 · 1 done' })
    expect(done.querySelector('.cal-dot')?.className).toBe('cal-dot cal-dot--done')
    expect(statusDotClass('blocked')).toBe('cal-dot cal-dot--blocked')
    expect(statusDotClass('odd')).toBe('cal-dot cal-dot--open')
  })
}

function dayTests() {
  it('loads another day into the vault and lists its tasks with due dates', async () => {
    render(<CalendarDrawer />)
    fireEvent.click(await screen.findByRole('button', { name: '2026-01-10 · 1 of 2 still open' }))
    expect(store.loadDate).toHaveBeenCalledWith('2026-01-10')
    expect(await screen.findByText('Late')).toBeTruthy()
    expect(screen.getByText('2026-01-09')).toBeTruthy()
    expect(screen.getByText('2026-01-10', { selector: '.cal-drawer__day-title' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open in Task Vault' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:open-panel')).toEqual([
        { date: '2026-01-10', taskId: undefined },
      ])
    )
  })

  it('says a day has no tasks, including when loading it fails', async () => {
    render(<CalendarDrawer />)
    expect(await screen.findByText('No tasks')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '2026-01-11 · nothing' }))
    expect(await screen.findByText('No tasks')).toBeTruthy()
  })
}
