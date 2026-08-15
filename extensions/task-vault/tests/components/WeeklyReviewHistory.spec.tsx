import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()
const mockNotify = vi.fn()

vi.mock('../../src/utils/notify', () => ({ notify: (...args: unknown[]) => mockNotify(...args) }))

import {
  WeeklyReviewHistory,
  groupActions,
  formatReviewDate,
  type ReviewAction,
} from '../../src/components/WeeklyReviewHistory'

const SUMMARY = {
  id: 'r1',
  startedAt: '2026-01-05T09:00:00.000Z',
  completedAt: '2026-01-05T10:00:00.000Z',
  status: 'completed' as const,
  actionCount: 2,
}

const DETAIL = {
  ...SUMMARY,
  worked: 'shipping small',
  didntWork: null,
  tryNext: null,
  actions: [
    {
      id: 'a1',
      step: 5,
      action: 'task-promoted',
      entityType: 'task' as const,
      entityId: 't1',
      entityLabel: 'Write the spec',
      detail: null,
      createdAt: '2026-01-05T09:05:00.000Z',
    },
    {
      id: 'a2',
      step: 3,
      action: 'project-status',
      entityType: 'project' as const,
      entityId: 'p1',
      entityLabel: 'Website rebuild',
      detail: 'archived',
      createdAt: '2026-01-05T09:06:00.000Z',
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    extensionBridge: { invoke: mockInvoke, on: vi.fn(() => () => {}) },
  }
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'task-vault:review:list') return Promise.resolve({ reviews: [SUMMARY] })
    if (channel === 'task-vault:review:get') return Promise.resolve({ review: DETAIL })
    return Promise.resolve({})
  })
})

afterEach(cleanup)

describe('groupActions', () => {
  const action = (over: Partial<ReviewAction>): ReviewAction => ({
    id: 'a',
    step: 1,
    action: 'captured',
    entityType: 'task',
    entityId: null,
    entityLabel: 'x',
    detail: null,
    createdAt: '2026-01-05T09:00:00.000Z',
    ...over,
  })

  it('groups actions by kind', () => {
    const groups = groupActions([
      action({ id: '1', action: 'task-promoted' }),
      action({ id: '2', action: 'task-promoted' }),
      action({ id: '3', action: 'task-archived' }),
    ])
    expect(groups.map((g) => [g.kind, g.items.length])).toEqual([
      ['task-promoted', 2],
      ['task-archived', 1],
    ])
  })

  it('omits kinds with no actions', () => {
    expect(groupActions([action({ action: 'captured' })]).map((g) => g.kind)).toEqual(['captured'])
  })

  it('returns nothing for an empty action list', () => {
    expect(groupActions([])).toEqual([])
  })

  it('orders groups by the flow of the review, not by input order', () => {
    const groups = groupActions([
      action({ id: '1', action: 'task-deleted' }),
      action({ id: '2', action: 'captured' }),
    ])
    expect(groups.map((g) => g.kind)).toEqual(['captured', 'task-deleted'])
  })
})

describe('formatReviewDate', () => {
  it('formats an ISO timestamp as a readable date', () => {
    expect(formatReviewDate('2026-01-05T09:00:00.000Z')).toMatch(/2026/)
  })

  it('passes through a value it cannot parse', () => {
    expect(formatReviewDate('not a date')).toBe('not a date')
  })
})

describe('WeeklyReviewHistory', () => {
  it('lists past reviews with their action count', async () => {
    render(<WeeklyReviewHistory />)
    await waitFor(() => expect(screen.getByText('2 actions')).toBeTruthy())
  })

  it('singularises a one-action review', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:review:list')
        return Promise.resolve({ reviews: [{ ...SUMMARY, actionCount: 1 }] })
      return Promise.resolve({})
    })
    render(<WeeklyReviewHistory />)
    await waitFor(() => expect(screen.getByText('1 action')).toBeTruthy())
  })

  it('explains the empty state', async () => {
    mockInvoke.mockResolvedValue({ reviews: [] })
    render(<WeeklyReviewHistory />)
    await waitFor(() => expect(screen.getByText(/No reviews recorded yet/i)).toBeTruthy())
  })

  it('marks a review that was never finished', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:review:list')
        return Promise.resolve({
          reviews: [{ ...SUMMARY, status: 'in_progress', completedAt: null }],
        })
      return Promise.resolve({})
    })
    render(<WeeklyReviewHistory />)
    await waitFor(() => expect(screen.getByText('in progress')).toBeTruthy())
  })

  it('shows what was done when a review is expanded', async () => {
    render(<WeeklyReviewHistory />)
    await waitFor(() => screen.getByText('2 actions'))

    fireEvent.click(screen.getByText('2 actions'))

    await waitFor(() => expect(screen.getByText('Write the spec')).toBeTruthy())
    expect(screen.getByText('Promoted to today')).toBeTruthy()
    expect(screen.getByText('Project status')).toBeTruthy()
    expect(screen.getByText('Website rebuild')).toBeTruthy()
    expect(screen.getByText(/archived/)).toBeTruthy()
  })

  it('shows the reflection alongside the actions', async () => {
    render(<WeeklyReviewHistory />)
    await waitFor(() => screen.getByText('2 actions'))
    fireEvent.click(screen.getByText('2 actions'))

    await waitFor(() => expect(screen.getByText('Reflection')).toBeTruthy())
    expect(screen.getByText('shipping small')).toBeTruthy()
  })

  it('collapses again on a second click', async () => {
    render(<WeeklyReviewHistory />)
    await waitFor(() => screen.getByText('2 actions'))

    fireEvent.click(screen.getByText('2 actions'))
    await waitFor(() => screen.getByText('Write the spec'))
    fireEvent.click(screen.getByText('2 actions'))

    await waitFor(() => expect(screen.queryByText('Write the spec')).toBeNull())
  })

  it('says so when a review recorded nothing', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:review:list')
        return Promise.resolve({ reviews: [{ ...SUMMARY, actionCount: 0 }] })
      if (channel === 'task-vault:review:get')
        return Promise.resolve({ review: { ...DETAIL, actions: [], worked: null } })
      return Promise.resolve({})
    })
    render(<WeeklyReviewHistory />)
    await waitFor(() => screen.getByText('0 actions'))
    fireEvent.click(screen.getByText('0 actions'))

    await waitFor(() => expect(screen.getByText(/Nothing was recorded/i)).toBeTruthy())
  })

  it('exports a review and reports where it landed', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:review:list') return Promise.resolve({ reviews: [SUMMARY] })
      if (channel === 'task-vault:review:export')
        return Promise.resolve({ filePath: '/tmp/weekly-review-2026-01-05.md' })
      return Promise.resolve({})
    })
    render(<WeeklyReviewHistory />)
    await waitFor(() => screen.getByText('2 actions'))

    fireEvent.click(screen.getByRole('button', { name: /Export review/i }))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        'success',
        expect.stringContaining('/tmp/weekly-review-2026-01-05.md'),
        'reviewExported'
      )
    )
  })

  it('stays quiet when the user cancels the export dialog', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:review:list') return Promise.resolve({ reviews: [SUMMARY] })
      if (channel === 'task-vault:review:export') return Promise.resolve({ canceled: true })
      return Promise.resolve({})
    })
    render(<WeeklyReviewHistory />)
    await waitFor(() => screen.getByText('2 actions'))

    fireEvent.click(screen.getByRole('button', { name: /Export review/i }))

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('task-vault:review:export', { reviewId: 'r1' })
    )
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('surfaces an export failure', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:review:list') return Promise.resolve({ reviews: [SUMMARY] })
      if (channel === 'task-vault:review:export') return Promise.resolve({ error: 'EACCES' })
      return Promise.resolve({})
    })
    render(<WeeklyReviewHistory />)
    await waitFor(() => screen.getByText('2 actions'))

    fireEvent.click(screen.getByRole('button', { name: /Export review/i }))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('EACCES'),
        'reviewExportFailed'
      )
    )
  })
})
