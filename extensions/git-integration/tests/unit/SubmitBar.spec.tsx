import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SubmitBar } from '../../src/components/pr-review/SubmitBar'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { DraftComment } from '../../src/schemas/pr-review.schema'

const mockPrReviewSubmit = vi.fn()

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prReviewSubmit: (...args: unknown[]) => mockPrReviewSubmit(...args),
  },
}))

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

const mockClearDrafts = vi.fn()

function makeDraft(overrides: Partial<DraftComment> = {}): DraftComment {
  return {
    id: 'd1',
    path: 'src/foo.ts',
    line: 10,
    startLine: null,
    side: 'RIGHT',
    body: 'fix this',
    fromFindingId: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePrReviewStore).mockImplementation((selector: unknown) =>
    (selector as (s: unknown) => unknown)({ clearDrafts: mockClearDrafts })
  )
})

describe('SubmitBar', () => {
  it('renders nothing when there are no drafts', () => {
    const { container } = render(
      <SubmitBar
        repoRoot="/repo"
        prNumber={1}
        headSHA="sha1"
        drafts={[]}
        onReviewDrafts={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows the draft count and file count', () => {
    render(
      <SubmitBar
        repoRoot="/repo"
        prNumber={1}
        headSHA="sha1"
        drafts={[makeDraft(), makeDraft({ id: 'd2', path: 'src/bar.ts' })]}
        onReviewDrafts={vi.fn()}
      />
    )
    expect(screen.getByText(/2 draft comments on 2 files/)).toBeTruthy()
  })

  it('shows the from-agent-finding count when present', () => {
    render(
      <SubmitBar
        repoRoot="/repo"
        prNumber={1}
        headSHA="sha1"
        drafts={[makeDraft({ fromFindingId: 'f1' })]}
        onReviewDrafts={vi.fn()}
      />
    )
    expect(screen.getByText(/1 from an agent finding/)).toBeTruthy()
  })

  it('calls onReviewDrafts when Review drafts is clicked', () => {
    const onReviewDrafts = vi.fn()
    render(
      <SubmitBar
        repoRoot="/repo"
        prNumber={1}
        headSHA="sha1"
        drafts={[makeDraft()]}
        onReviewDrafts={onReviewDrafts}
      />
    )
    fireEvent.click(screen.getByText('Review drafts'))
    expect(onReviewDrafts).toHaveBeenCalledTimes(1)
  })

  it('defaults the verdict seg to Approve', () => {
    render(
      <SubmitBar
        repoRoot="/repo"
        prNumber={1}
        headSHA="sha1"
        drafts={[makeDraft()]}
        onReviewDrafts={vi.fn()}
      />
    )
    const approveBtn = screen.getByText('Approve').closest('button')!
    expect(approveBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('posts drafts as comments in one prReviewSubmit call and clears them', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const draft = makeDraft()
    render(
      <SubmitBar
        repoRoot="/repo"
        prNumber={7}
        headSHA="sha7"
        drafts={[draft]}
        onReviewDrafts={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))
    await waitFor(() => expect(mockPrReviewSubmit).toHaveBeenCalledTimes(1))
    expect(mockPrReviewSubmit).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prNumber: 7,
      event: 'APPROVE',
      body: '',
      comments: [
        {
          path: draft.path,
          line: draft.line,
          startLine: draft.startLine,
          side: draft.side,
          body: draft.body,
        },
      ],
    })
    await waitFor(() => expect(mockClearDrafts).toHaveBeenCalledWith('/repo', 7, 'sha7'))
  })

  it('shows an error and does not clear drafts when the submit fails', async () => {
    mockPrReviewSubmit.mockRejectedValue(new Error('boom'))
    render(
      <SubmitBar
        repoRoot="/repo"
        prNumber={1}
        headSHA="sha1"
        drafts={[makeDraft()]}
        onReviewDrafts={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))
    await waitFor(() => screen.getByText(/boom/))
    expect(mockClearDrafts).not.toHaveBeenCalled()
  })
})
