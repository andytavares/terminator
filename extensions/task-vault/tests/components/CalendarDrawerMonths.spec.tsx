import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installVaultBridge, eventually } from './helpers/bridge'

import { CalendarDrawer, statusDotClass } from '../../src/components/CalendarDrawer'
import { useVaultDataStore } from '../../src/stores/vault-data.store'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'

let bridge: ReturnType<typeof installVaultBridge>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 0, 15, 12))
  useVaultDataStore.setState({ todayLog: null })
  useVaultNavStore.setState({ viewingDate: null })
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
describe('CalendarDrawer day marks', dayMarkTests)
describe('CalendarDrawer days', dayTests)
describe('CalendarDrawer empty days', emptyDayTests)

function monthTests() {
  it('wraps the year going back from January', async () => {
    const user = userEvent.setup()
    render(<CalendarDrawer />)
    expect(monthLabel()).toBe('January 2026')
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(monthLabel()).toBe('December 2025')
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-calendar-month')).toContainEqual({
        year: 2025,
        month: 12,
      })
    )
  })

  it('wraps the year going forward from December', async () => {
    const user = userEvent.setup()
    render(<CalendarDrawer />)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(monthLabel()).toBe('February 2026')
  })
}

function dayMarkTests() {
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
    const user = userEvent.setup()
    render(<CalendarDrawer />)
    await user.click(await screen.findByRole('button', { name: '2026-01-10 · 1 of 2 still open' }))
    await eventually(() => expect(useVaultNavStore.getState().viewingDate).toBe('2026-01-10'))
    expect(useVaultDataStore.getState().todayLog?.tasks.map((t) => t.text)).toEqual(['Late'])
    expect(await screen.findByText('Late')).toBeTruthy()
    expect(screen.getByText('2026-01-09')).toBeTruthy()
    expect(screen.getByText('2026-01-10', { selector: '.cal-drawer__day-title' })).toBeTruthy()
  })

  it('opens the chosen day in Task Vault', async () => {
    const user = userEvent.setup()
    render(<CalendarDrawer />)
    await user.click(await screen.findByRole('button', { name: '2026-01-10 · 1 of 2 still open' }))
    await user.click(await screen.findByRole('button', { name: 'Open in Task Vault' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:open-panel')).toEqual([
        { date: '2026-01-10', taskId: undefined },
      ])
    )
  })
}

function emptyDayTests() {
  it('says a day has no tasks', async () => {
    render(<CalendarDrawer />)
    expect(await screen.findByText('No tasks')).toBeTruthy()
  })

  it('says a day has no tasks when loading it fails', async () => {
    const user = userEvent.setup()
    render(<CalendarDrawer />)
    await user.click(await screen.findByRole('button', { name: '2026-01-11 · nothing' }))
    expect(
      await screen.findByText('2026-01-11', { selector: '.cal-drawer__day-title' })
    ).toBeTruthy()
    expect(screen.getByText('No tasks')).toBeTruthy()
  })
}
