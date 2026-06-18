import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { useCommentsStore } from '../../src/stores/comments.store'
import type { Comment } from '../../src/db/types'

const mockInvoke = vi.fn().mockResolvedValue({ data: { ok: true, status: 'resolved' } })

Object.defineProperty(window, 'electronAPI', {
  value: { extensionBridge: { invoke: mockInvoke } },
  writable: true,
  configurable: true,
})

import { CommentMargin } from '../../src/components/CommentMargin'

const baseComment: Comment = {
  id: 'c1',
  noteId: 'n1',
  parentId: null,
  body: 'Test comment',
  author: 'me',
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

describe('CommentMargin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCommentsStore.setState({ comments: [], loading: false })
  })

  it('shows hint when no comments', () => {
    const { container } = render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(container.querySelector('.notepad-comment-margin--empty')).toBeTruthy()
  })

  it('renders comment list from store', () => {
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(screen.getByText('Test comment')).toBeDefined()
  })

  it('shows orphaned comment with orphaned class', () => {
    useCommentsStore.setState({ comments: [orphanedComment], loading: false })
    const { container } = render(<CommentMargin noteId="n1" anchorTops={{}} />)
    expect(container.querySelector('.notepad-comment--orphaned')).toBeTruthy()
    expect(screen.getByText('Anchor lost')).toBeDefined()
  })

  it('Resolve button calls comments.resolve IPC', async () => {
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    const resolveBtn = screen.getByTitle('Resolve')
    fireEvent.click(resolveBtn)
    await Promise.resolve()
    expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:comments.resolve', {
      id: 'c1',
      resolved: true,
    })
  })

  it('Delete button calls comments.delete IPC', async () => {
    useCommentsStore.setState({ comments: [baseComment], loading: false })
    render(<CommentMargin noteId="n1" anchorTops={{}} />)
    const deleteBtn = screen.getByTitle('Delete comment')
    fireEvent.click(deleteBtn)
    await Promise.resolve()
    expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:comments.delete', { id: 'c1' })
  })
})
