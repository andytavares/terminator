import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { restoreLocalClock, setLocalClock } from '../support/clock'
import { eventually } from './helpers/bridge'

import { useVaultDataStore } from '../../src/stores/vault-data.store'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'

const mockInvoke = vi.fn()

// Track registered extensionBridge.on handlers so tests can trigger them
const bridgeHandlers = new Map<string, (data: unknown) => void>()
const mockOn = vi.fn((channel: string, handler: (data: unknown) => void) => {
  bridgeHandlers.set(channel, handler)
  return () => bridgeHandlers.delete(channel)
})

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: { invoke: mockInvoke, on: mockOn },
  },
  writable: true,
  configurable: true,
})

vi.mock('../../src/components/task-vault.css', () => ({}))

afterEach(() => {
  cleanup()
  bridgeHandlers.clear()
  vi.clearAllMocks()
  restoreLocalClock()
})

// Every test runs at noon on this day: setLocalClock in calendarDrawerTests.
const TODAY = '2026-01-15'

function dayTask(id: string, text: string) {
  return { id, text, status: 'open', metadata: {}, terminatorLinks: [] }
}

/** Answers the month query with `days` and every daily or today query with `daily`. */
function answerDays(days: unknown[], daily: unknown): void {
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'task-vault:vault:get-calendar-month') return Promise.resolve({ days })
    if (channel === 'task-vault:vault:get-daily') return Promise.resolve(daily)
    if (channel === 'task-vault:vault:get-today') return Promise.resolve(daily)
    return Promise.resolve({})
  })
}

async function renderDrawer() {
  const { CalendarDrawer } = await import('../../src/components/CalendarDrawer')
  return render(<CalendarDrawer />)
}

describe('CalendarDrawer', calendarDrawerTests)

function calendarDrawerTests() {
  beforeEach(() => {
    setLocalClock('UTC', `${TODAY}T12:00:00.000Z`)
    mockInvoke.mockResolvedValue({ days: [] })
    useVaultDataStore.setState({ todayLog: null })
    useVaultNavStore.setState({ viewingDate: null })
  })

  describe('today', calendarDrawerTodayTests)
  describe('opening a task', calendarDrawerOpeningTaskTests)
  describe('refreshing', calendarDrawerRefreshingTests)
}

function calendarDrawerTodayTests() {
  it('loads today into the vault and lists its tasks when the today cell is clicked', async () => {
    const user = userEvent.setup()
    const log = {
      date: TODAY,
      tasks: [dayTask('t1', 'Test task')],
      events: [],
      notes: [],
      exists: true,
    }
    answerDays([{ date: TODAY, status: 'open', count: 1 }], log)

    await renderDrawer()
    // The cell's label says what the day is carrying; a grid already shows the date.
    await user.click(await screen.findByRole('button', { name: new RegExp(`^${TODAY}`) }))

    await eventually(() => expect(useVaultNavStore.getState().viewingDate).toBe(TODAY))
    expect(useVaultDataStore.getState().todayLog).toEqual(log)
    expect(screen.getByText('Test task')).toBeTruthy()
  })
}

function calendarDrawerOpeningTaskTests() {
  it('invokes task-vault:open-panel with taskId when a task in the day panel is clicked', async () => {
    const user = userEvent.setup()
    const todayStr = TODAY

    answerDays([{ date: todayStr, status: 'done', count: 1 }], {
      date: todayStr,
      tasks: [dayTask('task-abc', 'My task')],
      events: [],
      notes: [],
      exists: true,
    })

    await renderDrawer()
    await screen.findByText('My task')
    await user.click(screen.getByText('My task'))

    expect(mockInvoke).toHaveBeenCalledWith('task-vault:open-panel', {
      date: todayStr,
      taskId: 'task-abc',
    })
  })
}

function calendarDrawerRefreshingTests() {
  it('refreshes task list when task-vault:push:index-updated fires', async () => {
    const todayStr = TODAY

    answerDays([], { tasks: [dayTask('t1', 'Updated task')] })

    await renderDrawer()
    await screen.findByText('Updated task')

    // Simulate a task update broadcast
    answerDays([], { tasks: [dayTask('t1', 'Reopened task')] })

    await act(async () => {
      bridgeHandlers.get('task-vault:push:index-updated')?.({})
    })

    await screen.findByText('Reopened task')
    expect(screen.queryByText('Updated task')).toBeNull()

    // Also verify today's date is still selected (selected-date not reset)
    // The cell's label says what the day is carrying now, not just its date.
    expect(screen.getByRole('button', { name: new RegExp(`^${todayStr}`) })).toBeTruthy()
  })
}
