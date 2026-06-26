import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockInvoke = vi.fn()
const mockLoadDate = vi.fn()
const mockLoadToday = vi.fn()
const mockNavigateToTask = vi.fn()

vi.mock('../../src/stores/vault.store', () => ({
  useVaultStore: (
    sel?: (s: {
      loadDate: typeof mockLoadDate
      loadToday: typeof mockLoadToday
      calendarRefreshKey: number
      kanbanLanes: []
    }) => unknown
  ) => {
    const store = {
      loadDate: mockLoadDate,
      loadToday: mockLoadToday,
      calendarRefreshKey: 0,
      kanbanLanes: [],
    }
    if (sel) return sel(store)
    return store
  },
}))

vi.mock('../../src/stores/vault-nav.store', () => ({
  useVaultNavStore: {
    getState: () => ({ navigateToTask: mockNavigateToTask }),
  },
}))

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
})

async function renderDrawer() {
  const { CalendarDrawer } = await import('../../src/components/CalendarDrawer')
  return render(<CalendarDrawer />)
}

describe('CalendarDrawer', () => {
  beforeEach(() => {
    mockInvoke.mockResolvedValue({ days: [] })
  })

  it('renders the calendar panel immediately (always open)', async () => {
    await renderDrawer()
    await waitFor(() => {
      expect(screen.getByTitle('Previous month')).toBeTruthy()
      expect(screen.getByTitle('Next month')).toBeTruthy()
    })
  })

  it('calls get-calendar-month on mount', async () => {
    await renderDrawer()
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'task-vault:vault:get-calendar-month',
        expect.objectContaining({ year: expect.any(Number), month: expect.any(Number) })
      )
    })
  })

  it('navigates to today and shows task list when today cell is clicked', async () => {
    const user = userEvent.setup()
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:vault:get-calendar-month') {
        return Promise.resolve({ days: [{ date: todayStr, status: 'open', count: 1 }] })
      }
      if (channel === 'task-vault:vault:get-daily') {
        return Promise.resolve({
          date: todayStr,
          tasks: [
            { id: 't1', text: 'Test task', status: 'open', metadata: {}, terminatorLinks: [] },
          ],
          events: [],
          notes: [],
          exists: true,
        })
      }
      return Promise.resolve({})
    })

    await renderDrawer()
    await waitFor(() => screen.getByTitle(todayStr))
    await user.click(screen.getByTitle(todayStr))

    expect(mockLoadToday).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText('Test task')).toBeTruthy()
    })
  })

  it('invokes task-vault:open-panel with taskId when a task in the day panel is clicked', async () => {
    const user = userEvent.setup()
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:vault:get-calendar-month') {
        return Promise.resolve({ days: [{ date: todayStr, status: 'done', count: 1 }] })
      }
      if (channel === 'task-vault:vault:get-daily') {
        return Promise.resolve({
          date: todayStr,
          tasks: [
            { id: 'task-abc', text: 'My task', status: 'open', metadata: {}, terminatorLinks: [] },
          ],
          events: [],
          notes: [],
          exists: true,
        })
      }
      return Promise.resolve({})
    })

    await renderDrawer()
    await waitFor(() => screen.getByText('My task'))
    await user.click(screen.getByText('My task'))

    expect(mockInvoke).toHaveBeenCalledWith('task-vault:open-panel', {
      date: todayStr,
      taskId: 'task-abc',
    })
  })

  it('navigates to previous month on prev button click', async () => {
    const user = userEvent.setup()
    await renderDrawer()
    await waitFor(() => screen.getByTitle('Previous month'))
    await user.click(screen.getByTitle('Previous month'))

    // 1: get-calendar-month on mount, 2: get-daily for today on mount, 3: get-calendar-month after prev
    expect(mockInvoke).toHaveBeenCalledTimes(3)
  })

  it('navigates to next month on next button click', async () => {
    const user = userEvent.setup()
    await renderDrawer()
    await waitFor(() => screen.getByTitle('Next month'))
    await user.click(screen.getByTitle('Next month'))

    // 1: get-calendar-month on mount, 2: get-daily for today on mount, 3: get-calendar-month after next
    expect(mockInvoke).toHaveBeenCalledTimes(3)
  })

  it('refreshes task list when task-vault:push:index-updated fires', async () => {
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:vault:get-calendar-month') return Promise.resolve({ days: [] })
      if (channel === 'task-vault:vault:get-daily')
        return Promise.resolve({
          tasks: [
            { id: 't1', text: 'Updated task', status: 'open', metadata: {}, terminatorLinks: [] },
          ],
        })
      return Promise.resolve({})
    })

    await renderDrawer()
    await waitFor(() => screen.getByText('Updated task'))

    // Simulate a task update broadcast
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:vault:get-calendar-month') return Promise.resolve({ days: [] })
      if (channel === 'task-vault:vault:get-daily')
        return Promise.resolve({
          tasks: [
            { id: 't1', text: 'Reopened task', status: 'open', metadata: {}, terminatorLinks: [] },
          ],
        })
      return Promise.resolve({})
    })

    await act(async () => {
      bridgeHandlers.get('task-vault:push:index-updated')?.({})
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText('Reopened task')).toBeTruthy())
    expect(screen.queryByText('Updated task')).toBeNull()

    // Also verify today's date is still selected (selected-date not reset)
    expect(screen.getByTitle(todayStr)).toBeTruthy()
  })
})
