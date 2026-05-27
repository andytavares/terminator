import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockInvoke = vi.fn()
const mockLoadDate = vi.fn()
const mockLoadToday = vi.fn()

vi.mock('../../src/stores/vault.store', () => ({
  useVaultStore: (
    sel?: (s: { loadDate: typeof mockLoadDate; loadToday: typeof mockLoadToday }) => unknown
  ) => {
    const store = { loadDate: mockLoadDate, loadToday: mockLoadToday }
    if (sel) return sel(store)
    return store
  },
}))

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: { invoke: mockInvoke, on: vi.fn(() => vi.fn()) },
  },
  writable: true,
  configurable: true,
})

vi.mock('../../src/components/task-vault.css', () => ({}))

afterEach(() => {
  cleanup()
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

  it('shows day task list and Go button when a day cell is clicked', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('Test task')).toBeTruthy()
      expect(screen.getByTitle('Go to this day')).toBeTruthy()
    })
  })

  it('calls loadToday when Go is clicked for today', async () => {
    const user = userEvent.setup()
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:vault:get-calendar-month') {
        return Promise.resolve({ days: [{ date: todayStr, status: 'done', count: 1 }] })
      }
      if (channel === 'task-vault:vault:get-daily') {
        return Promise.resolve({ date: todayStr, tasks: [], events: [], notes: [], exists: true })
      }
      return Promise.resolve({})
    })

    await renderDrawer()
    await waitFor(() => screen.getByTitle(todayStr))
    await user.click(screen.getByTitle(todayStr))
    await waitFor(() => screen.getByTitle('Go to this day'))
    await user.click(screen.getByTitle('Go to this day'))

    expect(mockLoadToday).toHaveBeenCalled()
  })

  it('navigates to previous month on prev button click', async () => {
    const user = userEvent.setup()
    await renderDrawer()
    await waitFor(() => screen.getByTitle('Previous month'))
    await user.click(screen.getByTitle('Previous month'))

    expect(mockInvoke).toHaveBeenCalledTimes(2) // initial mount + after prev
  })

  it('navigates to next month on next button click', async () => {
    const user = userEvent.setup()
    await renderDrawer()
    await waitFor(() => screen.getByTitle('Next month'))
    await user.click(screen.getByTitle('Next month'))

    expect(mockInvoke).toHaveBeenCalledTimes(2) // initial mount + after next
  })
})
