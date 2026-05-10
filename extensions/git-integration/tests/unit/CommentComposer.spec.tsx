import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommentComposer } from '../../src/components/pr-review/CommentComposer'

vi.mock('../../src/components/pr-review/RichContent', () => ({
  RichContent: ({ children }: { children: string }) => (
    <div data-testid="rich-content">{children}</div>
  ),
}))

const mockPrCommentAdd = vi.fn()
const mockPrCommentReply = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    github: {
      prCommentAdd: mockPrCommentAdd,
      prCommentReply: mockPrCommentReply,
    },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
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

  it('disables Comment button when body is empty', () => {
    render(<CommentComposer {...newCommentProps} />)
    const commentBtn = screen.getByText('Comment')
    expect(commentBtn.closest('button')?.disabled).toBe(true)
  })

  it('enables Comment button when body has content', () => {
    render(<CommentComposer {...newCommentProps} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), { target: { value: 'LGTM' } })
    const commentBtn = screen.getByText('Comment')
    expect(commentBtn.closest('button')?.disabled).toBe(false)
  })

  it('calls prCommentAdd on submit', async () => {
    mockPrCommentAdd.mockResolvedValue({ success: true })
    const onSubmitted = vi.fn()
    render(<CommentComposer {...newCommentProps} onSubmitted={onSubmitted} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), { target: { value: 'Nice!' } })
    fireEvent.click(screen.getByText('Comment'))
    await waitFor(() =>
      expect(mockPrCommentAdd).toHaveBeenCalledWith({
        repoRoot: '/repo',
        prNumber: 42,
        commitId: 'abc123',
        path: 'src/foo.ts',
        line: 10,
        startLine: undefined,
        side: 'RIGHT',
        body: 'Nice!',
      })
    )
    expect(onSubmitted).toHaveBeenCalled()
  })

  it('shows error when submission fails', async () => {
    mockPrCommentAdd.mockRejectedValue(new Error('Network error'))
    render(<CommentComposer {...newCommentProps} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByText('Comment'))
    await waitFor(() => screen.getByText(/Network error/))
    expect(screen.getByText(/Network error/)).toBeTruthy()
  })
})

describe('CommentComposer (reply)', () => {
  it('calls prCommentReply on submit', async () => {
    mockPrCommentReply.mockResolvedValue({ success: true })
    const onSubmitted = vi.fn()
    render(<CommentComposer {...replyProps} onSubmitted={onSubmitted} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), {
      target: { value: 'Agreed!' },
    })
    fireEvent.click(screen.getByText('Comment'))
    await waitFor(() =>
      expect(mockPrCommentReply).toHaveBeenCalledWith({
        repoRoot: '/repo',
        prNumber: 42,
        inReplyToId: 99,
        body: 'Agreed!',
      })
    )
    expect(onSubmitted).toHaveBeenCalled()
  })

  it('shows error when reply submission returns error field', async () => {
    mockPrCommentReply.mockResolvedValue({ error: 'FORBIDDEN' })
    render(<CommentComposer {...replyProps} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByText('Comment'))
    await waitFor(() => screen.getByText(/FORBIDDEN/))
  })
})
