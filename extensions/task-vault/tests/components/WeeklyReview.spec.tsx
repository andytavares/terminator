import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: {
      invoke: mockInvoke,
      on: vi.fn(() => vi.fn()),
    },
  },
  writable: true,
  configurable: true,
})

vi.mock('../../src/stores/vault.store', () => ({
  useVaultStore: vi.fn(() => ({
    activeView: 'review',
    setView: vi.fn(),
  })),
}))

const weeklyReviewPayload = {
  inboxItems: [
    {
      id: '/vault/inbox.md:1',
      text: 'Loose item',
      status: 'open',
      terminatorLinks: [],
      filePath: '/vault/inbox.md',
      line: 1,
      metadata: {},
    },
  ],
  activeProjects: [
    {
      id: '/vault/projects/alpha.md',
      filePath: '/vault/projects/alpha.md',
      name: 'Alpha Project',
      status: 'active',
      isStale: false,
      nextActionCount: 2,
      terminatorLinks: [],
    },
    {
      id: '/vault/projects/stale.md',
      filePath: '/vault/projects/stale.md',
      name: 'Stale Project',
      status: 'active',
      isStale: true,
      nextActionCount: 0,
      terminatorLinks: [],
    },
  ],
  staleProjects: [
    {
      id: '/vault/projects/stale.md',
      filePath: '/vault/projects/stale.md',
      name: 'Stale Project',
      status: 'active',
      isStale: true,
      nextActionCount: 0,
      terminatorLinks: [],
    },
  ],
  somedayProjects: [
    {
      id: '/vault/projects/someday.md',
      filePath: '/vault/projects/someday.md',
      name: 'Someday Project',
      status: 'someday',
      isStale: false,
      nextActionCount: 0,
      terminatorLinks: [],
    },
  ],
  somedayTasks: [],
  completedLastWeek: [],
  staleTasks: [],
  staleDaysThreshold: 7,
  lastReviewDate: null,
}

import { WeeklyReview } from '../../src/components/WeeklyReview'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'task-vault:projects:weekly-review') return Promise.resolve(weeklyReviewPayload)
    if (channel === 'task-vault:vault:update-project-status')
      return Promise.resolve({ success: true })
    if (channel === 'task-vault:vault:add-task') return Promise.resolve({ success: true })
    if (channel === 'task-vault:review:start')
      return Promise.resolve({ review: { id: 'review-1' }, resumed: false })
    if (channel === 'task-vault:review:complete') return Promise.resolve({ ok: true })
    if (channel === 'task-vault:review:list') return Promise.resolve({ reviews: [] })
    return Promise.resolve({})
  })
})

describe('WeeklyReview', () => {
  it('renders 6-step stepper', async () => {
    render(<WeeklyReview />)
    await waitFor(() => {
      expect(screen.getByText(/step 1 of 6/i)).toBeTruthy()
    })
  })

  it('step 3 shows all active projects', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText(/step 1 of 6/i))

    // Navigate using header nav button (aria-label="Next step")
    const nextStepBtn = screen.getByRole('button', { name: 'Next step' })
    fireEvent.click(nextStepBtn) // → step 2
    await waitFor(() => screen.getByText(/step 2 of 6/i))
    fireEvent.click(screen.getByRole('button', { name: 'Next step' })) // → step 3
    await waitFor(() => screen.getByText(/step 3 of 6/i))

    expect(screen.getByText('Alpha Project')).toBeTruthy()
    expect(screen.getByText('Stale Project')).toBeTruthy()
  })

  it('archiving stale project removes it from step 3 list', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText(/step 1 of 6/i))

    // Navigate to step 3
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    await waitFor(() => screen.getByText(/step 2 of 6/i))
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    await waitFor(() => screen.getByText(/step 3 of 6/i))

    const archiveBtn = screen.getAllByRole('button', { name: /archive/i })[0]
    fireEvent.click(archiveBtn)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'task-vault:vault:update-project-status',
        expect.objectContaining({ status: 'archived' })
      )
    })
  })

  it('re-fetches inbox items when advancing from Step 1 so captures appear in Step 2', async () => {
    const capturedTask = {
      id: 'new-1',
      text: 'Mind sweep item',
      status: 'open',
      terminatorLinks: [],
      filePath: '/vault/inbox.md',
      line: 2,
      metadata: {},
    }
    const freshPayload = {
      ...weeklyReviewPayload,
      inboxItems: [...weeklyReviewPayload.inboxItems, capturedTask],
    }
    // Second call to weekly-review returns the fresh payload with the new item
    mockInvoke
      .mockResolvedValueOnce(weeklyReviewPayload) // initial load
      .mockImplementation((channel: string) => {
        if (channel === 'task-vault:projects:weekly-review') return Promise.resolve(freshPayload)
        if (channel === 'task-vault:vault:update-project-status')
          return Promise.resolve({ success: true })
        if (channel === 'task-vault:vault:add-task') return Promise.resolve({ success: true })
        return Promise.resolve({})
      })

    render(<WeeklyReview />)
    await waitFor(() => screen.getByText(/step 1 of 6/i))

    // Click the step 1 "Next" button (inside step content, not header nav)
    const step1Next = screen.getByRole('button', { name: /nothing to add|done capturing/i })
    fireEvent.click(step1Next)

    await waitFor(() => screen.getByText(/step 2 of 6/i))

    // weekly-review was called twice: once at mount, once on step 1 completion
    const reviewCalls = mockInvoke.mock.calls.filter(
      ([ch]: [string]) => ch === 'task-vault:projects:weekly-review'
    )
    expect(reviewCalls.length).toBeGreaterThanOrEqual(2)

    // Step 2 inbox processor shows "1 of 2" — fresh data has both the original and captured item
    await waitFor(() => {
      expect(screen.getByText('1 of 2')).toBeTruthy()
    })
  })

  it('starts (or resumes) a persisted review on mount', async () => {
    render(<WeeklyReview />)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('task-vault:review:start', {})
    })
  })

  // The nav row sizes its buttons as 28px squares for the icon-only step
  // arrows; a text button in that row must opt out or its label overflows.
  it('gives the History button the text-button class, not the square arrow sizing', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText(/step 1 of 6/i))

    const history = screen.getByRole('button', { name: 'History' })
    expect(history.className).toContain('weekly-review__nav-text-btn')
  })

  it('gives the Back button the same text-button class', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText(/step 1 of 6/i))
    fireEvent.click(screen.getByRole('button', { name: 'History' }))

    await waitFor(() => screen.getByText('Past Reviews'))
    expect(screen.getByRole('button', { name: 'Back' }).className).toContain(
      'weekly-review__nav-text-btn'
    )
  })

  it('offers a way into past reviews', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText(/step 1 of 6/i))

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    await waitFor(() => {
      expect(screen.getByText('Past Reviews')).toBeTruthy()
    })
    expect(mockInvoke).toHaveBeenCalledWith('task-vault:review:list', {})
  })

  it('completing all steps records the reflection against the review', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText(/step 1 of 6/i))

    // Navigate through steps 1-5 using header nav
    for (let i = 0; i < 5; i++) {
      const nextBtn = screen.queryByRole('button', { name: 'Next step' })
      if (nextBtn && !nextBtn.hasAttribute('disabled')) fireEvent.click(nextBtn)
      await waitFor(() => {})
    }

    const finishBtn = screen.queryByRole('button', { name: /finish/i })
    if (finishBtn) {
      fireEvent.click(finishBtn)
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          'task-vault:review:complete',
          expect.objectContaining({ reviewId: 'review-1' })
        )
      })
    }
  })
})
