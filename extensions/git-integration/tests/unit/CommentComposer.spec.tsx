import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommentComposer } from '../../src/components/pr-review/CommentComposer'

vi.mock('../../src/components/pr-review/RichContent', () => ({
  RichContent: ({ children }: { children: string }) => (
    <div data-testid="rich-content">{children}</div>
  ),
}))

const mockPrCommentReply = vi.fn()
const mockRecordUsage = vi.fn()

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prCommentReply: (...args: unknown[]) => mockPrCommentReply(...args),
  },
}))

const mockAddDraft = vi.fn()

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: (selector: (s: { addDraft: typeof mockAddDraft }) => unknown) =>
    selector({ addDraft: mockAddDraft }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { electronAPI: { usage: { record: mockRecordUsage } } })
})

const newCommentProps = {
  repoRoot: '/repo',
  prNumber: 42,
  commitId: 'abc123',
  path: 'src/foo.ts',
  line: 10,
  side: 'RIGHT' as const,
  onSubmitted: vi.fn(),
  onCancel: vi.fn(),
}

const replyProps = {
  repoRoot: '/repo',
  prNumber: 42,
  inReplyToId: 99,
  onSubmitted: vi.fn(),
  onCancel: vi.fn(),
}

describe('CommentComposer (new comment)', () => {
  it('switches to preview tab', async () => {
    const user = userEvent.setup()
    render(<CommentComposer {...newCommentProps} />)
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByText('Nothing to preview.')).toBeTruthy()
  })

  it('shows RichContent when body is non-empty in preview', async () => {
    const user = userEvent.setup()
    render(<CommentComposer {...newCommentProps} />)
    await user.type(screen.getByRole('textbox'), 'Hello')
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTestId('rich-content')).toBeTruthy()
  })
})

describe('CommentComposer (new comment) — calls onCancel when Cancel is clicked', () => {
  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<CommentComposer {...newCommentProps} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables the submit button when body is empty', () => {
    render(<CommentComposer {...newCommentProps} />)
    const commentBtn = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Add to pending review',
    })
    expect(commentBtn.disabled).toBe(true)
  })

  it('enables the submit button when body has content', async () => {
    const user = userEvent.setup()
    render(<CommentComposer {...newCommentProps} />)
    await user.type(screen.getByRole('textbox'), 'LGTM')
    const commentBtn = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Add to pending review',
    })
    expect(commentBtn.disabled).toBe(false)
  })

  it('shows the "sent when you submit your review" note', () => {
    render(<CommentComposer {...newCommentProps} />)
    expect(screen.getByText('Sent when you submit your review')).toBeTruthy()
  })
})

describe('CommentComposer (new comment) — adds the comment to the pending review on submit', () => {
  it('adds the comment to the pending review on submit', async () => {
    const user = userEvent.setup()
    const onSubmitted = vi.fn()
    render(<CommentComposer {...newCommentProps} onSubmitted={onSubmitted} />)
    await user.type(screen.getByRole('textbox'), 'Nice!')
    await user.click(screen.getByRole('button', { name: 'Add to pending review' }))
    await waitFor(() => expect(mockAddDraft).toHaveBeenCalled())
    expect(mockAddDraft).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: 42, headSHA: 'abc123' },
      expect.objectContaining({
        path: 'src/foo.ts',
        line: 10,
        startLine: null,
        side: 'RIGHT',
        body: 'Nice!',
        fromFindingId: null,
      })
    )
    expect(onSubmitted).toHaveBeenCalled()
  })
})

describe('CommentComposer (new comment) — shows New comment · line N header, and edited from agent finding when fromFindingId is set', () => {
  it('shows "New comment · line N" header, and "edited from agent finding" when fromFindingId is set', () => {
    render(<CommentComposer {...newCommentProps} fromFindingId="finding-1" />)
    expect(screen.getByText(/New comment · line 10/)).toBeTruthy()
    expect(screen.getByText(/edited from agent finding/)).toBeTruthy()
  })

  it('prefills the body from initialBody', () => {
    render(<CommentComposer {...newCommentProps} initialBody="drafted text" />)
    expect((screen.getByPlaceholderText(/Leave a comment/) as HTMLTextAreaElement).value).toBe(
      'drafted text'
    )
  })
})

describe('CommentComposer (new comment) — names the line range of a multi-line comment', () => {
  it('shows "New comment · lines N–M" when startLine is set', () => {
    render(<CommentComposer {...newCommentProps} startLine={4} line={12} />)
    expect(screen.getByText(/New comment · lines 4–12/)).toBeTruthy()
  })
})

describe('CommentComposer (reply)', () => {
  it('calls prCommentReply on submit, not addDraft', async () => {
    const user = userEvent.setup()
    mockPrCommentReply.mockResolvedValue({ success: true })
    const onSubmitted = vi.fn()
    render(<CommentComposer {...replyProps} onSubmitted={onSubmitted} />)
    await user.type(screen.getByRole('textbox'), 'Agreed!')
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    await waitFor(() =>
      expect(mockPrCommentReply).toHaveBeenCalledWith({
        repoRoot: '/repo',
        prNumber: 42,
        inReplyToId: 99,
        body: 'Agreed!',
      })
    )
    expect(mockAddDraft).not.toHaveBeenCalled()
    expect(onSubmitted).toHaveBeenCalled()
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('review-comment')
  })
})

describe('CommentComposer (reply) — shows error when reply submission returns error field', () => {
  it('shows error when reply submission returns error field', async () => {
    const user = userEvent.setup()
    mockPrCommentReply.mockResolvedValue({ error: 'FORBIDDEN' })
    render(<CommentComposer {...replyProps} />)
    await user.type(screen.getByRole('textbox'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    await screen.findByText(/FORBIDDEN/)
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('review-comment', { failed: true })
  })
})
