import { describe, it, expect } from 'vitest'
import { reanchorComment } from '../../../src/editor/reanchor'
import type { Comment } from '../../../src/db/types'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    noteId: 'n1',
    parentId: null,
    body: 'comment',
    author: 'me',
    status: 'open',
    startOffset: 6,
    endOffset: 11,
    quote: 'world',
    prefix: 'Hello ',
    suffix: '!',
    createdAt: '',
    updatedAt: '',
    replies: [],
    ...overrides,
  }
}

describe('reanchorComment', () => {
  const doc = 'Hello world!'

  it('returns ok when offset still matches', () => {
    const result = reanchorComment(makeComment(), doc)
    expect(result.status).toBe('ok')
    expect(result.anchor.from).toBe(6)
    expect(result.anchor.to).toBe(11)
    expect(result.newFrom).toBeUndefined()
  })

  it('falls back to text-quote search when offset is stale', () => {
    const doc2 = 'AAA Hello world!'
    const result = reanchorComment(makeComment(), doc2)
    expect(result.status).toBe('ok')
    expect(result.newFrom).toBe(10)
    expect(result.newTo).toBe(15)
  })

  it('returns orphaned when quote not found anywhere', () => {
    const result = reanchorComment(makeComment({ quote: 'XYZNOTFOUND' }), doc)
    expect(result.status).toBe('orphaned')
  })

  it('returns orphaned when startOffset is null', () => {
    const result = reanchorComment(makeComment({ startOffset: null, endOffset: null }), doc)
    expect(result.status).toBe('orphaned')
  })

  it('returns orphaned when quote is null', () => {
    const result = reanchorComment(makeComment({ quote: null }), doc)
    expect(result.status).toBe('orphaned')
  })

  it('disambiguates by prefix and suffix', () => {
    // Two instances of "world" in doc — correct one has prefix "Hello "
    const ambiguous = 'world is big. Hello world!'
    const result = reanchorComment(
      makeComment({ startOffset: 99, endOffset: 99 + 5 }), // stale offset
      ambiguous
    )
    expect(result.status).toBe('ok')
    // Should pick the second "world" which has prefix "Hello "
    expect(result.newFrom).toBe(20)
  })

  it('falls back to first match when context is ambiguous', () => {
    // No prefix/suffix context
    const noContext = 'world and world'
    const result = reanchorComment(
      makeComment({ prefix: '', suffix: '', startOffset: 99, endOffset: 99 + 5 }),
      noContext
    )
    expect(result.status).toBe('ok')
    expect(result.newFrom).toBe(0)
  })
})
