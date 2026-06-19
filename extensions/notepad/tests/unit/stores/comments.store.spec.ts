import { describe, it, expect, beforeEach } from 'vitest'
import { useCommentsStore } from '../../../src/stores/comments.store'
import type { Comment } from '../../../src/db/types'

const mockComment: Comment = {
  id: 'c1',
  noteId: 'n1',
  parentId: null,
  body: 'test',
  author: 'me',
  status: 'open',
  startOffset: 0,
  endOffset: 5,
  quote: 'hello',
  prefix: '',
  suffix: ' world',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  replies: [],
}

describe('comments.store', () => {
  beforeEach(() => {
    useCommentsStore.setState({ comments: [], loading: false })
  })

  it('starts with empty comments', () => {
    expect(useCommentsStore.getState().comments).toEqual([])
  })

  it('setComments replaces comments', () => {
    useCommentsStore.getState().setComments([mockComment])
    expect(useCommentsStore.getState().comments).toHaveLength(1)
  })

  it('addComment appends to list', () => {
    useCommentsStore.getState().addComment(mockComment)
    expect(useCommentsStore.getState().comments).toHaveLength(1)
  })

  it('removeComment removes by id', () => {
    useCommentsStore.setState({ comments: [mockComment], loading: false })
    useCommentsStore.getState().removeComment('c1')
    expect(useCommentsStore.getState().comments).toHaveLength(0)
  })

  it('updateComment patches by id', () => {
    useCommentsStore.setState({ comments: [mockComment], loading: false })
    useCommentsStore.getState().updateComment('c1', { body: 'updated', status: 'resolved' })
    const c = useCommentsStore.getState().comments[0]
    expect(c.body).toBe('updated')
    expect(c.status).toBe('resolved')
  })

  it('setLoading sets loading flag', () => {
    useCommentsStore.getState().setLoading(true)
    expect(useCommentsStore.getState().loading).toBe(true)
  })
})
