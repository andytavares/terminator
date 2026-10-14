import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InlineCommentThread } from '../../src/components/pr-review/InlineCommentThread'
import type { Thread } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/components/pr-review/RichContent', () => ({
  RichContent: ({ children }: { children: string }) => <div>{children}</div>,
}))

type ThreadComment = Thread['comments'][number]

function comment(overrides: Partial<ThreadComment> = {}): ThreadComment {
  return {
    id: 1,
    author: 'alice',
    authorAvatarUrl: '',
    body: 'First',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    path: 'src/foo.ts',
    line: 10,
    startLine: null,
    side: 'RIGHT',
    diffHunk: '',
    outdated: false,
    threadId: 'thread-1',
    isReply: false,
    parentId: null,
    ...overrides,
  }
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    path: 'src/foo.ts',
    line: 10,
    startLine: null,
    side: 'RIGHT',
    collapsed: false,
    outdated: false,
    resolved: false,
    comments: [
      comment({
        authorAvatarUrl: 'https://avatar.url/alice',
        body: 'Nice code',
        createdAt: '2024-01-15T10:00:00Z',
      }),
    ],
    ...overrides,
  }
}

describe('InlineCommentThread', () => {
  it('renders comment author', () => {
    render(<InlineCommentThread thread={makeThread()} />)
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('renders comment body', () => {
    render(<InlineCommentThread thread={makeThread()} />)
    expect(screen.getByText('Nice code')).toBeTruthy()
  })

  it('shows outdated label when thread is outdated', () => {
    render(<InlineCommentThread thread={makeThread({ outdated: true })} />)
    expect(screen.getByText('Outdated')).toBeTruthy()
  })

  it('does not show outdated label when not outdated', () => {
    render(<InlineCommentThread thread={makeThread({ outdated: false })} />)
    expect(screen.queryByText('Outdated')).toBeNull()
  })

  it('shows reply button when onReply is provided', () => {
    const onReply = vi.fn()
    render(<InlineCommentThread thread={makeThread()} onReply={onReply} />)
    expect(screen.getByText('Reply')).toBeTruthy()
  })
})

describe('InlineCommentThread — calls onReply with thread id when reply button clicked', () => {
  it('calls onReply with thread id when reply button clicked', () => {
    const onReply = vi.fn()
    render(<InlineCommentThread thread={makeThread()} onReply={onReply} />)
    fireEvent.click(screen.getByText('Reply'))
    expect(onReply).toHaveBeenCalledWith('thread-1')
  })

  it('does not show reply button when onReply is not provided', () => {
    render(<InlineCommentThread thread={makeThread()} />)
    expect(screen.queryByText('Reply')).toBeNull()
  })
})

describe('InlineCommentThread — shows show more replies button when thread is collapsed with multiple comments', () => {
  it('shows "show more replies" button when thread is collapsed with multiple comments', () => {
    const thread = makeThread({
      collapsed: true,
      comments: [
        comment(),
        comment({
          id: 2,
          author: 'bob',
          body: 'Reply',
          createdAt: '2024-01-01T01:00:00Z',
          isReply: true,
        }),
        comment({
          id: 3,
          author: 'carol',
          body: 'Another reply',
          createdAt: '2024-01-01T02:00:00Z',
          isReply: true,
        }),
      ],
    })
    render(<InlineCommentThread thread={thread} />)
    expect(screen.getByText(/Show 2 more replies/)).toBeTruthy()
  })
})

describe('InlineCommentThread — expands collapsed thread when show more is clicked', () => {
  it('expands collapsed thread when show more is clicked', () => {
    const thread = makeThread({
      collapsed: true,
      comments: [
        comment(),
        comment({
          id: 2,
          author: 'bob',
          body: 'Second',
          createdAt: '2024-01-01T01:00:00Z',
          isReply: true,
        }),
      ],
    })
    render(<InlineCommentThread thread={thread} />)
    fireEvent.click(screen.getByText(/Show 1 more reply/))
    expect(screen.getByText('Second')).toBeTruthy()
  })
})

describe('InlineCommentThread — shows singular reply label for single hidden comment', () => {
  it('shows singular "reply" label for single hidden comment', () => {
    const thread = makeThread({
      collapsed: true,
      comments: [
        comment(),
        comment({
          id: 2,
          author: 'bob',
          body: 'Second',
          createdAt: '2024-01-01T01:00:00Z',
          isReply: true,
        }),
      ],
    })
    render(<InlineCommentThread thread={thread} />)
    expect(screen.getByText('Show 1 more reply')).toBeTruthy()
  })
})

describe('InlineCommentThread — renders avatar image', () => {
  it('renders avatar image', () => {
    render(<InlineCommentThread thread={makeThread()} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('alt')).toBe('alice')
  })

  it('shows "Resolved" and dims the thread when resolved', () => {
    const { container } = render(<InlineCommentThread thread={makeThread({ resolved: true })} />)
    expect(screen.getByText('Resolved')).toBeTruthy()
    expect(container.querySelector('.rs-thread--resolved')).toBeTruthy()
  })

  it('does not show "Resolved" when not resolved', () => {
    render(<InlineCommentThread thread={makeThread({ resolved: false })} />)
    expect(screen.queryByText('Resolved')).toBeNull()
  })
})
