import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('renders the comment time as a machine-readable time element', () => {
    render(<InlineCommentThread thread={makeThread()} />)
    const time = screen.getByRole('time')
    expect(time.getAttribute('datetime')).toBe('2024-01-15T10:00:00.000Z')
  })

  it('renders comment body', () => {
    render(<InlineCommentThread thread={makeThread()} />)
    expect(screen.getByText('Nice code')).toBeTruthy()
  })

  it.each([
    { outdated: true, labelCount: 1 },
    { outdated: false, labelCount: 0 },
  ])('shows $labelCount Outdated label when outdated is $outdated', ({ outdated, labelCount }) => {
    render(<InlineCommentThread thread={makeThread({ outdated })} />)
    expect(screen.queryAllByText('Outdated')).toHaveLength(labelCount)
  })
})

describe('InlineCommentThread — calls onReply with thread id when reply button clicked', () => {
  it('calls onReply with thread id when reply button clicked', async () => {
    const user = userEvent.setup()
    const onReply = vi.fn()
    render(<InlineCommentThread thread={makeThread()} onReply={onReply} />)
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    expect(onReply).toHaveBeenCalledWith('thread-1')
  })

  it('does not show reply button when onReply is not provided', () => {
    render(<InlineCommentThread thread={makeThread()} />)
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
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
  it('expands collapsed thread when show more is clicked', async () => {
    const user = userEvent.setup()
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
    expect(screen.queryByText('Second')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show 1 more reply' }))
    expect(screen.getByText('Second')).toBeTruthy()
  })
})

describe('InlineCommentThread — renders avatar image', () => {
  it('renders avatar image', () => {
    render(<InlineCommentThread thread={makeThread()} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('alt')).toBe('alice')
  })

  it.each([
    { resolved: true, labelCount: 1 },
    { resolved: false, labelCount: 0 },
  ])('shows $labelCount Resolved label when resolved is $resolved', ({ resolved, labelCount }) => {
    render(<InlineCommentThread thread={makeThread({ resolved })} />)
    expect(screen.queryAllByText('Resolved')).toHaveLength(labelCount)
  })
})
