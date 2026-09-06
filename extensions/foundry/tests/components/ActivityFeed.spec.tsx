import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockCommentList = vi.fn()
const mockHistoryLoad = vi.fn()
const mockCardComment = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    commentList: mockCommentList,
    historyLoad: mockHistoryLoad,
    cardComment: mockCardComment,
  }),
}))

import { ActivityFeed } from '../../src/components/ActivityFeed.js'

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommentList.mockResolvedValue({ comments: [] })
    mockHistoryLoad.mockResolvedValue({ entries: [] })
    mockCardComment.mockResolvedValue({ comment: { id: 'c9', author: 'you', body: 'x', ts: 'z' } })
  })

  it('merges comments and history chronologically', async () => {
    mockCommentList.mockResolvedValue({
      comments: [{ id: 'c1', author: 'you', body: 'Use the util', ts: '2026-06-30T02:00:00Z' }],
    })
    mockHistoryLoad.mockResolvedValue({
      entries: [
        { ts: '2026-06-30T01:00:00Z', actor: 'agent', action: 'run_complete', phase: 'plan' },
      ],
    })
    render(<ActivityFeed featureDir="/repo/specs/x" />)
    await waitFor(() => screen.getByText('Use the util'))
    const items = screen.getAllByRole('listitem')
    // event (earlier) before comment (later)
    expect(items[0].textContent).toContain('run_complete')
    expect(items[1].textContent).toContain('Use the util')
  })

  it('posts a comment and reloads', async () => {
    render(<ActivityFeed featureDir="/repo/specs/x" />)
    await waitFor(() => screen.getByLabelText('Comment'))
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Prefer fakes' } })
    fireEvent.click(screen.getByText('Comment'))
    await waitFor(() =>
      expect(mockCardComment).toHaveBeenCalledWith({
        featureDir: '/repo/specs/x',
        body: 'Prefer fakes',
      })
    )
  })

  it('shows an empty state', async () => {
    render(<ActivityFeed featureDir="/repo/specs/x" />)
    await waitFor(() => expect(screen.getByText(/no activity yet/i)).toBeTruthy())
  })
})
