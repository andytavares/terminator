import { describe, it, expect } from 'vitest'
import { buildThreads } from '../../../extensions/git-integration/src/github/pr-review-service-renderer'
import type { InlineComment } from '../../../extensions/git-integration/src/schemas/pr-review.schema'

function makeComment(overrides: Partial<InlineComment> = {}): InlineComment {
  return {
    id: 1,
    author: 'alice',
    authorAvatarUrl: '',
    body: 'LGTM',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    path: 'src/app.ts',
    line: 42,
    startLine: null,
    side: 'RIGHT',
    diffHunk: '@@ -1,2 +1,3 @@',
    outdated: false,
    threadId: 'thread-1',
    isReply: false,
    parentId: null,
    ...overrides,
  }
}

describe('buildThreads', () => {
  it('returns empty array for no comments', () => {
    expect(buildThreads([])).toEqual([])
  })

  it('creates one thread per unique threadId', () => {
    const comments = [
      makeComment({ id: 1, threadId: 'thread-1' }),
      makeComment({ id: 2, threadId: 'thread-2' }),
    ]
    const threads = buildThreads(comments)
    expect(threads).toHaveLength(2)
  })

  it('groups replies under the same thread', () => {
    const comments = [
      makeComment({ id: 1, threadId: 'thread-1', isReply: false }),
      makeComment({ id: 2, threadId: 'thread-1', isReply: true, parentId: 1 }),
      makeComment({ id: 3, threadId: 'thread-1', isReply: true, parentId: 1 }),
    ]
    const threads = buildThreads(comments)
    expect(threads).toHaveLength(1)
    expect(threads[0].comments).toHaveLength(3)
  })

  it('sorts comments by createdAt within a thread', () => {
    const comments = [
      makeComment({ id: 3, threadId: 't-1', createdAt: '2024-01-03T00:00:00Z' }),
      makeComment({ id: 1, threadId: 't-1', createdAt: '2024-01-01T00:00:00Z' }),
      makeComment({ id: 2, threadId: 't-1', createdAt: '2024-01-02T00:00:00Z' }),
    ]
    const threads = buildThreads(comments)
    expect(threads[0].comments[0].id).toBe(1)
    expect(threads[0].comments[1].id).toBe(2)
    expect(threads[0].comments[2].id).toBe(3)
  })

  it('sets thread metadata from root comment', () => {
    const comment = makeComment({
      id: 1,
      threadId: 't-1',
      path: 'src/app.ts',
      line: 42,
      startLine: 38,
      side: 'LEFT',
    })
    const threads = buildThreads([comment])
    expect(threads[0].path).toBe('src/app.ts')
    expect(threads[0].line).toBe(42)
    expect(threads[0].startLine).toBe(38)
    expect(threads[0].side).toBe('LEFT')
  })

  it('marks thread as outdated when any comment is outdated', () => {
    const comments = [
      makeComment({ id: 1, threadId: 't-1', outdated: false }),
      makeComment({ id: 2, threadId: 't-1', outdated: true }),
    ]
    const threads = buildThreads(comments)
    expect(threads[0].outdated).toBe(true)
  })

  it('thread is not outdated when no comments are outdated', () => {
    const comments = [
      makeComment({ id: 1, threadId: 't-1', outdated: false }),
      makeComment({ id: 2, threadId: 't-1', outdated: false }),
    ]
    const threads = buildThreads(comments)
    expect(threads[0].outdated).toBe(false)
  })

  it('collapses thread when there are 4 or more replies', () => {
    const comments = Array.from({ length: 5 }, (_, i) =>
      makeComment({ id: i + 1, threadId: 't-1' })
    )
    const threads = buildThreads(comments)
    expect(threads[0].collapsed).toBe(true)
  })

  it('does not collapse thread with fewer than 4 replies', () => {
    const comments = [
      makeComment({ id: 1, threadId: 't-1' }),
      makeComment({ id: 2, threadId: 't-1' }),
      makeComment({ id: 3, threadId: 't-1' }),
    ]
    const threads = buildThreads(comments)
    expect(threads[0].collapsed).toBe(false)
  })

  it('uses threadId as the thread id', () => {
    const comment = makeComment({ threadId: 'my-unique-thread' })
    const threads = buildThreads([comment])
    expect(threads[0].id).toBe('my-unique-thread')
  })

  it('handles multiple separate threads correctly', () => {
    const comments = [
      makeComment({ id: 1, threadId: 't-1', path: 'src/a.ts', line: 10 }),
      makeComment({ id: 2, threadId: 't-1', path: 'src/a.ts', line: 10 }),
      makeComment({ id: 3, threadId: 't-2', path: 'src/b.ts', line: 20 }),
    ]
    const threads = buildThreads(comments)
    expect(threads).toHaveLength(2)
    const t1 = threads.find((t) => t.id === 't-1')
    const t2 = threads.find((t) => t.id === 't-2')
    expect(t1?.comments).toHaveLength(2)
    expect(t2?.comments).toHaveLength(1)
    expect(t2?.path).toBe('src/b.ts')
  })
})
