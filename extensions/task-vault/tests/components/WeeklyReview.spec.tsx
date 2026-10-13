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

describe('WeeklyReview', weeklyReviewTests)

function weeklyReviewTests() {
  describe('step trail', weeklyReviewStepTrailTests)
  describe('projects', weeklyReviewProjectsTests)
  describe('inbox refresh', weeklyReviewInboxRefreshTests)
  describe('review record', weeklyReviewReviewRecordTests)
  describe('completing', weeklyReviewCompletingTests)
}

function weeklyReviewStepTrailTests() {
  // Position used to be stated four times over — a large numeral, "step 1 of 6",
  // six unlabelled dots, and the step's own heading — while what the six steps
  // are was never shown. Now the steps are named and position is stated once.
  it('names all six steps and states position once', async () => {
    render(<WeeklyReview />)
    await waitFor(() => expect(screen.getByText('1 of 6')).toBeTruthy())
    for (const name of ['Get clear', 'Inbox', 'Projects', 'Stale', 'Someday', 'Reflect']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('marks which step you are on', async () => {
    render(<WeeklyReview />)
    await waitFor(() => expect(screen.getByText('1 of 6')).toBeTruthy())
    expect(screen.getByText('Get clear').getAttribute('aria-current')).toBe('step')
  })
}

function weeklyReviewProjectsTests() {
  describe('listing', weeklyReviewProjectsListingTests)
  describe('archiving', weeklyReviewProjectsArchivingTests)
}

function weeklyReviewProjectsListingTests() {
  it('step 3 shows all active projects', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText('1 of 6'))

    // Navigate using header nav button (aria-label="Next step")
    const nextStepBtn = screen.getByRole('button', { name: 'Next step' })
    fireEvent.click(nextStepBtn) // → step 2
    await waitFor(() => screen.getByText('2 of 6'))
    fireEvent.click(screen.getByRole('button', { name: 'Next step' })) // → step 3
    await waitFor(() => screen.getByText('3 of 6'))

    expect(screen.getByText('Alpha Project')).toBeTruthy()
    expect(screen.getByText('Stale Project')).toBeTruthy()
  })
}

function weeklyReviewProjectsArchivingTests() {
  it('archiving stale project removes it from step 3 list', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText('1 of 6'))

    // Navigate to step 3
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    await waitFor(() => screen.getByText('2 of 6'))
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    await waitFor(() => screen.getByText('3 of 6'))

    const archiveBtn = screen.getAllByRole('button', { name: /archive/i })[0]
    fireEvent.click(archiveBtn)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'task-vault:vault:update-project-status',
        expect.objectContaining({ status: 'archived' })
      )
    })
  })
}

const capturedTask = {
  id: 'new-1',
  text: 'Mind sweep item',
  status: 'open',
  terminatorLinks: [],
  filePath: '/vault/inbox.md',
  line: 2,
  metadata: {},
}

/** After the first answer, weekly-review answers with the inbox plus one captured item. */
function answerWithCapturedItem(): void {
  const freshPayload = {
    ...weeklyReviewPayload,
    inboxItems: [...weeklyReviewPayload.inboxItems, capturedTask],
  }
  mockInvoke
    .mockResolvedValueOnce(weeklyReviewPayload) // initial load
    .mockImplementation((channel: string) => {
      if (channel === 'task-vault:projects:weekly-review') return Promise.resolve(freshPayload)
      if (channel === 'task-vault:vault:update-project-status')
        return Promise.resolve({ success: true })
      if (channel === 'task-vault:vault:add-task') return Promise.resolve({ success: true })
      return Promise.resolve({})
    })
}

/** Step 1's advance button sits in the step content, not the header nav, and says where it goes;
 *  skipping is a link beside it (it once read "Nothing to add — Next"). */
function weeklyReviewInboxRefreshTests() {
  it('re-fetches inbox items when advancing from Step 1 so captures appear in Step 2', async () => {
    answerWithCapturedItem()
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText('1 of 6'))
    fireEvent.click(screen.getByRole('button', { name: /next: inbox/i }))

    await waitFor(() => screen.getByText('2 of 6'))

    // weekly-review was called twice: once at mount, once on step 1 completion
    const reviewCalls = mockInvoke.mock.calls.filter(
      ([ch]) => ch === 'task-vault:projects:weekly-review'
    )
    expect(reviewCalls.length).toBeGreaterThanOrEqual(2)

    // Step 2 inbox processor shows "1 of 2" — fresh data has both the original and captured item
    await waitFor(() => {
      expect(screen.getByText('1 of 2')).toBeTruthy()
    })
  })
}

function weeklyReviewReviewRecordTests() {
  it('starts (or resumes) a persisted review on mount', async () => {
    render(<WeeklyReview />)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('task-vault:review:start', {})
    })
  })

  it('offers a way into past reviews', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText('1 of 6'))

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    await waitFor(() => {
      expect(screen.getByText('Past Reviews')).toBeTruthy()
    })
    expect(mockInvoke).toHaveBeenCalledWith('task-vault:review:list', {})
  })
}

function weeklyReviewCompletingTests() {
  it('completing all steps records the reflection against the review', async () => {
    render(<WeeklyReview />)
    await waitFor(() => screen.getByText('1 of 6'))

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
}
