import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { useCommentsStore } from '../../src/stores/comments.store'
import type { Comment } from '../../src/db/types'

const mockInvoke = vi.fn()

beforeEach(() => {
  mockInvoke.mockResolvedValue({ data: { ok: true, status: 'resolved' } })
  vi.stubGlobal('electronAPI', { extensionBridge: { invoke: mockInvoke } })
})

import { CommentMargin } from '../../src/components/CommentMargin'
import { eventually } from './helpers/note-surface'

const baseComment: Comment = {
  id: 'c1',
  noteId: 'n1',
  parentId: null,
  body: 'Test comment',
  author: 'Andrew',
  status: 'open',
  startOffset: 0,
  endOffset: 5,
  quote: 'Hello',
  prefix: '',
  suffix: ' world',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  replies: [],
}

const orphanedComment: Comment = {
  ...baseComment,
  id: 'c2',
  status: 'orphaned',
}

const resolvedComment: Comment = {
  ...baseComment,
  id: 'c3',
  status: 'resolved',
}

describe('CommentMargin', commentMarginTests)

describe('CommentMargin resolved section', () => {
  it('says whether the resolved comments are shown', async () => {
    const user = userEvent.setup()
    useCommentsStore.setState({ comments: [resolvedComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    const toggle = screen.getByRole('button', { name: /1 resolved/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
})

function commentMarginTests() {
  beforeEach(() => {
    vi.clearAllMocks()
    useCommentsStore.setState({ comments: [], loading: false })
  })

  describe('header and empty state', commentMarginHeaderEmptyStateTests)
  describe('comment cards', commentMarginCommentCardsTests)
  describe('thread actions', commentMarginThreadActionsTests)
  describe('replies', commentMarginRepliesTests)
}

function commentMarginHeaderEmptyStateTests() {
  it('shows hint when no comments', () => {
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(screen.getByText('Select text and click + to add a comment')).toBeDefined()
  })

  it('shows open count badge when there are open comments', () => {
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(screen.getByText('1 open')).toBeDefined()
  })

  it('does not show badge when all resolved', () => {
    useCommentsStore.setState({ comments: [resolvedComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(screen.queryByText(/open/)).toBeNull()
  })
}

function commentMarginCommentCardsTests() {
  it('renders comment body from store', () => {
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(screen.getByText('Test comment')).toBeDefined()
  })

  it('renders author avatar initial and name', () => {
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.getByText('Andrew')).toBeDefined()
  })

  it('lists an orphaned comment under the Orphaned heading', () => {
    useCommentsStore.setState({ comments: [orphanedComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(screen.getByText('Orphaned (1)')).toBeDefined()
    expect(screen.getByText(orphanedComment.body)).toBeDefined()
  })
}

function commentMarginThreadActionsTests() {
  it('Resolve button calls comments.resolve IPC', async () => {
    const user = userEvent.setup()
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    await eventually(() =>
      expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:comments.resolve', {
        id: 'c1',
        resolved: true,
      })
    )
  })

  it('Delete button calls comments.delete IPC', async () => {
    const user = userEvent.setup()
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    await user.click(screen.getByTitle('Delete comment'))
    await eventually(() =>
      expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:comments.delete', { id: 'c1' })
    )
  })
}

function commentMarginRepliesTests() {
  it('renders inline replies with arrow prefix', () => {
    const commentWithReply: Comment = {
      ...baseComment,
      replies: [
        {
          ...baseComment,
          id: 'r1',
          parentId: 'c1',
          body: 'Reply body text',
        },
      ],
    }
    useCommentsStore.setState({ comments: [commentWithReply], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(screen.getByText('↳')).toBeDefined()
    expect(screen.getByText('reply:')).toBeDefined()
    expect(screen.getByText('Reply body text')).toBeDefined()
  })

  it('Reply text link opens reply form', async () => {
    const user = userEvent.setup()
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    await user.click(screen.getByText('Reply'))
    expect(screen.getByPlaceholderText('Write a reply…')).toBeTruthy()
  })
}
