import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { ContributionsSection } from '../../src/components/contributions/ContributionsSection'
import { periodRange } from '../../src/components/contributions/period-presets'
import type { ContributionsDay, ContributionsReply } from '../../src/schemas/contributions.schema'

const mockInvoke = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('electronAPI', { extensionBridge: { invoke: mockInvoke } })
})

function emptyDay(date: string, future = false): ContributionsDay {
  return { date, opened: 0, merged: 0, reviewed: 0, total: 0, level: 0, future }
}

/** A full 53-week calendar ending the week of Friday 2026-10-16. */
function makeWeeks(): ContributionsDay[][] {
  const weeks: ContributionsDay[][] = []
  const start = new Date(2025, 9, 13)
  for (let week = 0; week < 53; week += 1) {
    weeks.push(
      Array.from({ length: 7 }, (_, row) => {
        const date = new Date(start)
        date.setDate(start.getDate() + week * 7 + row)
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
          date.getDate()
        ).padStart(2, '0')}`
        return emptyDay(iso, iso > '2026-10-16')
      })
    )
  }
  const thursday = weeks[52][3]
  Object.assign(thursday, { opened: 2, merged: 1, reviewed: 0, total: 3, level: 2 })
  return weeks
}

function makeReply(overrides: Partial<ContributionsReply> = {}): ContributionsReply {
  return {
    calendar: {
      weeks: makeWeeks(),
      total: 412,
      currentStreak: 4,
      longestStreak: 24,
      mostActiveMonth: { month: '2026-09', total: 98 },
      mostActiveWeekday: { weekday: 4, total: 91 },
    },
    period: { opened: 96, merged: 81, reviewed: 235, total: 412 },
    previous: { opened: 84, merged: 72, reviewed: 198, total: 354 },
    repos: ['klaviyo/terminator', 'klaviyo/amigo'],
    fetchedAt: '2026-10-16T12:00:00Z',
    ...overrides,
  }
}

function answerWith(reply: unknown): void {
  mockInvoke.mockImplementation((channel: string) =>
    channel === 'github:contributions' ? Promise.resolve(reply) : Promise.reject(new Error(channel))
  )
}

/** The from/to today's default preset (This year) would send. */
function defaultRange(): { from: string; to: string } {
  return periodRange('year', new Date())
}

async function renderSection(reply: unknown): Promise<ReturnType<typeof render>> {
  answerWith(reply)
  const view = render(<ContributionsSection />)
  await screen.findByText(/\d+ contributions in the last year/)
  return view
}

/** The period popover, on Custom range, with both dates typed. */
async function openCustomRange(
  user: UserEvent,
  dates: { from: string; to: string }
): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'This year' }))
  await user.click(await screen.findByRole('radio', { name: 'Custom range…' }))
  await user.type(await screen.findByLabelText('From'), dates.from)
  await user.type(await screen.findByLabelText('To'), dates.to)
}

describe('ContributionsSection — renders the period stats and their change', () => {
  it('shows each count with its delta against the previous period', async () => {
    await renderSection(makeReply())
    expect(screen.getByText('412')).toBeDefined()
    expect(screen.getByText('PRs opened')).toBeDefined()
    expect(screen.getByText('96')).toBeDefined()
    expect(screen.getByText('+58 vs prev period')).toBeDefined()
  })
})

describe('ContributionsSection — counts Contributions as opened plus merged plus reviewed', () => {
  it('shows the sum and a flat delta for each equal stat', async () => {
    const counts = { opened: 10, merged: 20, reviewed: 30, total: 60 }
    await renderSection(makeReply({ period: counts, previous: counts }))
    expect(screen.getAllByText('Same as prev period')).toHaveLength(4)
  })
})

describe('ContributionsSection — marks a lower count with a red down delta', () => {
  it('draws one down arrow beside the lower merged count', async () => {
    const period = { opened: 96, merged: 70, reviewed: 235, total: 401 }
    await renderSection(makeReply({ period }))
    expect(screen.getByText('−2 vs prev period').classList.contains('ct-delta--down')).toBe(true)
    const ups = screen.getAllByText(/^\+\d+ vs prev period$/)
    expect(ups.map((delta) => delta.classList.contains('ct-delta--up'))).toEqual([true, true, true])
  })
})

describe('ContributionsSection — draws 53 week columns', () => {
  it('renders a column per week', async () => {
    await renderSection(makeReply())
    expect(screen.getAllByTestId('heatmap-week')).toHaveLength(53)
  })
})

describe('ContributionsSection — scales the heatmap to its width', () => {
  it('splits the width into one fractional column per week and places months by percent', async () => {
    await renderSection(makeReply())
    const weeks = screen.getByTestId('heatmap-weeks')
    expect(weeks.style.gridTemplateColumns).toBe('repeat(53, minmax(0, 1fr))')
    const months = screen.getAllByTestId('heatmap-month')
    const offsets = months.map((month) => month.style.getPropertyValue('--ct-month-at'))
    expect(offsets[0]).toBe('0%')
    expect(offsets.every((offset) => /^\d+(\.\d+)?%$/.test(offset))).toBe(true)
  })
})

describe('ContributionsSection — does not draw future days', () => {
  it('hides the cells after today and titles a day with its count', async () => {
    await renderSection(makeReply())
    const days = screen.getAllByTestId('heatmap-day')
    expect(days.filter((day) => day.style.visibility === 'hidden').length).toBeGreaterThan(0)
    expect(screen.getByTitle('3 contributions on Thu, Oct 15, 2026')).toBeDefined()
  })
})

describe('ContributionsSection — shows the highlights', () => {
  it('names the streaks, the most active month and the most active day', async () => {
    await renderSection(makeReply())
    expect(screen.getByText('4 days')).toBeDefined()
    expect(screen.getByText('24 days')).toBeDefined()
    expect(screen.getByText("Weekends don't break it")).toBeDefined()
    expect(screen.getByText('Sep 2026')).toBeDefined()
    expect(screen.getByText('98 contributions')).toBeDefined()
    expect(screen.getByText('Thursdays')).toBeDefined()
  })
})

describe('ContributionsSection — requests the default preset range on load', () => {
  it("calls the channel with This year's from and to", async () => {
    await renderSection(makeReply())
    expect(mockInvoke).toHaveBeenCalledWith('github:contributions', defaultRange())
  })
})

describe('ContributionsSection — sends the chosen repository on the next request', () => {
  it('passes repo on the channel', async () => {
    const user = userEvent.setup()
    await renderSection(makeReply())
    await user.click(screen.getByRole('button', { name: 'All repositories' }))
    await user.click(await screen.findByRole('radio', { name: 'klaviyo/amigo' }))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('github:contributions', {
        ...defaultRange(),
        repo: 'klaviyo/amigo',
      })
    )
  })
})

describe('ContributionsSection — sends a chosen preset with its from and to', () => {
  it('passes the preset range on the channel', async () => {
    const user = userEvent.setup()
    await renderSection(makeReply())
    await user.click(screen.getByRole('button', { name: 'This year' }))
    await user.click(await screen.findByRole('radio', { name: 'Last 30 days' }))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'github:contributions',
        periodRange('last30', new Date())
      )
    )
  })
})

describe('ContributionsSection — rejects a custom range whose from is after its to', () => {
  it('shows an alert and does not call the channel', async () => {
    const user = userEvent.setup()
    await renderSection(makeReply())
    await openCustomRange(user, { from: '2026-10-10', to: '2026-10-01' })
    const callsBefore = mockInvoke.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(mockInvoke.mock.calls.length).toBe(callsBefore)
  })
})

describe('ContributionsSection — applies a valid custom range', () => {
  it('sends the custom from and to', async () => {
    const user = userEvent.setup()
    await renderSection(makeReply())
    await openCustomRange(user, { from: '2026-10-01', to: '2026-10-10' })
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('github:contributions', {
        from: '2026-10-01',
        to: '2026-10-10',
      })
    )
  })
})

describe('ContributionsSection — asks for a refresh with refresh: true', () => {
  it('passes refresh on the channel', async () => {
    const user = userEvent.setup()
    await renderSection(makeReply())
    await user.click(screen.getByRole('button', { name: 'Refresh contributions' }))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('github:contributions', {
        ...defaultRange(),
        refresh: true,
      })
    )
  })
})

describe('ContributionsSection — NOT_AUTHENTICATED', () => {
  it('hints at sign-in', async () => {
    answerWith({ error: 'NOT_AUTHENTICATED' })
    render(<ContributionsSection />)
    expect(
      await screen.findByText('Sign in to GitHub in Settings to see your contributions.')
    ).toBeDefined()
  })
})

describe('ContributionsSection — RATE_LIMITED', () => {
  it('shows the rate-limit text and a Retry button', async () => {
    answerWith({ error: 'RATE_LIMITED' })
    render(<ContributionsSection />)
    expect(await screen.findByText(/rate-limited/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })
})

describe('ContributionsSection — another error', () => {
  it('shows it with a Retry button and recovers when the retry succeeds', async () => {
    const user = userEvent.setup()
    answerWith({ error: 'boom' })
    render(<ContributionsSection />)
    expect(await screen.findByText('boom')).toBeDefined()
    answerWith(makeReply())
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('412 contributions in the last year')).toBeDefined()
  })
})
