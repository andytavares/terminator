import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommentComposer } from '../../src/components/pr-review/CommentComposer'

vi.mock('../../src/components/pr-review/RichContent', () => ({
  RichContent: ({ children }: { children: string }) => (
    <div data-testid="rich-content">{children}</div>
  ),
}))

const mockPrCommentAdd = vi.fn()
const mockPrCommentReply = vi.fn()

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prCommentAdd: (...args: unknown[]) => mockPrCommentAdd(...args),
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
  it('renders Write and Preview tabs', () => {
    render(<CommentComposer {...newCommentProps} />)
    expect(screen.getByText('Write')).toBeTruthy()
    expect(screen.getByText('Preview')).toBeTruthy()
  })

  it('renders textarea in write mode', () => {
    render(<CommentComposer {...newCommentProps} />)
    expect(screen.getByPlaceholderText(/Leave a comment/)).toBeTruthy()
  })

  it('switches to preview tab', () => {
    render(<CommentComposer {...newCommentProps} />)
    fireEvent.click(screen.getByText('Preview'))
    expect(screen.getByText('Nothing to preview.')).toBeTruthy()
  })

  it('shows RichContent when body is non-empty in preview', () => {
    render(<CommentComposer {...newCommentProps} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByText('Preview'))
    expect(screen.getByTestId('rich-content')).toBeTruthy()
  })

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()
    render(<CommentComposer {...newCommentProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables the submit button when body is empty', () => {
    render(<CommentComposer {...newCommentProps} />)
    const commentBtn = screen.getByText('Add to pending review')
    expect(commentBtn.closest('button')?.disabled).toBe(true)
  })

  it('enables the submit button when body has content', () => {
    render(<CommentComposer {...newCommentProps} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), { target: { value: 'LGTM' } })
    const commentBtn = screen.getByText('Add to pending review')
    expect(commentBtn.closest('button')?.disabled).toBe(false)
  })

  it('shows the "sent when you submit your review" note', () => {
    render(<CommentComposer {...newCommentProps} />)
    expect(screen.getByText('Sent when you submit your review')).toBeTruthy()
  })

  it('calls addDraft, not prCommentAdd, on submit', async () => {
    const onSubmitted = vi.fn()
    render(<CommentComposer {...newCommentProps} onSubmitted={onSubmitted} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), { target: { value: 'Nice!' } })
    fireEvent.click(screen.getByText('Add to pending review'))
    await waitFor(() => expect(mockAddDraft).toHaveBeenCalled())
    expect(mockAddDraft).toHaveBeenCalledWith(
      '/repo',
      42,
      'abc123',
      expect.objectContaining({
        path: 'src/foo.ts',
        line: 10,
        startLine: null,
        side: 'RIGHT',
        body: 'Nice!',
        fromFindingId: null,
      })
    )
    expect(mockPrCommentAdd).not.toHaveBeenCalled()
    expect(onSubmitted).toHaveBeenCalled()
  })

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

describe('CommentComposer (reply)', () => {
  it('renders a Reply submit button', () => {
    render(<CommentComposer {...replyProps} />)
    expect(screen.getByText('Reply')).toBeTruthy()
  })

  it('calls prCommentReply on submit, not addDraft', async () => {
    mockPrCommentReply.mockResolvedValue({ success: true })
    const onSubmitted = vi.fn()
    render(<CommentComposer {...replyProps} onSubmitted={onSubmitted} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), {
      target: { value: 'Agreed!' },
    })
    fireEvent.click(screen.getByText('Reply'))
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
  })

  it('shows error when reply submission returns error field', async () => {
    mockPrCommentReply.mockResolvedValue({ error: 'FORBIDDEN' })
    render(<CommentComposer {...replyProps} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByText('Reply'))
    await waitFor(() => screen.getByText(/FORBIDDEN/))
  })
})
