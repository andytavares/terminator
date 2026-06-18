import { describe, it, expect } from 'vitest'
import { rowToNote, rowToTag, rowToComment, rowToSearchResult } from '../../../src/db/mappers'

describe('rowToNote', () => {
  it('maps a DB row to a Note domain object', () => {
    const row = {
      id: 'abc',
      title: 'Test',
      body: '# Hello',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      archived_at: null,
      tags: 'foo,bar',
    }
    const note = rowToNote(row)
    expect(note.id).toBe('abc')
    expect(note.title).toBe('Test')
    expect(note.body).toBe('# Hello')
    expect(note.tags).toEqual(['foo', 'bar'])
    expect(note.archivedAt).toBeNull()
    expect(note.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(note.updatedAt).toBe('2026-01-02T00:00:00Z')
  })

  it('returns empty tags array when tags column is empty string', () => {
    const row = {
      id: 'x',
      title: 'T',
      body: '',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
      tags: '',
    }
    expect(rowToNote(row).tags).toEqual([])
  })

  it('returns empty tags array when tags column is null', () => {
    const row = {
      id: 'x',
      title: 'T',
      body: '',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
      tags: null as unknown as string,
    }
    expect(rowToNote(row).tags).toEqual([])
  })

  it('preserves archived_at when set', () => {
    const row = {
      id: 'x',
      title: 'T',
      body: '',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: '2026-02-01T00:00:00Z',
      tags: '',
    }
    expect(rowToNote(row).archivedAt).toBe('2026-02-01T00:00:00Z')
  })
})

describe('rowToTag', () => {
  it('maps a DB row to a Tag domain object', () => {
    const row = { id: 't1', name: 'infra', note_count: 3 }
    const tag = rowToTag(row)
    expect(tag.id).toBe('t1')
    expect(tag.name).toBe('infra')
    expect(tag.noteCount).toBe(3)
  })

  it('handles zero note count', () => {
    const row = { id: 't2', name: 'empty', note_count: 0 }
    expect(rowToTag(row).noteCount).toBe(0)
  })
})

describe('rowToComment', () => {
  it('maps a DB row to a Comment domain object', () => {
    const row = {
      id: 'c1',
      note_id: 'n1',
      parent_id: null,
      body: 'nice',
      author: 'me',
      status: 'open',
      start_offset: 10,
      end_offset: 20,
      quote: 'nice text',
      prefix: 'before ',
      suffix: ' after',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const comment = rowToComment(row)
    expect(comment.id).toBe('c1')
    expect(comment.noteId).toBe('n1')
    expect(comment.parentId).toBeNull()
    expect(comment.startOffset).toBe(10)
    expect(comment.endOffset).toBe(20)
    expect(comment.quote).toBe('nice text')
    expect(comment.replies).toEqual([])
  })

  it('handles reply comment with null anchor data', () => {
    const row = {
      id: 'c2',
      note_id: 'n1',
      parent_id: 'c1',
      body: 'agreed',
      author: 'me',
      status: 'open',
      start_offset: null,
      end_offset: null,
      quote: null,
      prefix: null,
      suffix: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const comment = rowToComment(row)
    expect(comment.parentId).toBe('c1')
    expect(comment.startOffset).toBeNull()
    expect(comment.replies).toEqual([])
  })
})

describe('rowToSearchResult', () => {
  it('maps a DB row to a SearchResult', () => {
    const row = {
      id: 'n1',
      title: 'Auth Notes',
      snippet: '…<mark>auth</mark>…',
      tags: 'infra',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
    }
    const result = rowToSearchResult(row)
    expect(result.id).toBe('n1')
    expect(result.snippet).toContain('<mark>auth</mark>')
    expect(result.tags).toEqual(['infra'])
    expect(result.archivedAt).toBeNull()
  })

  it('handles multiple tags in search result', () => {
    const row = {
      id: 'n2',
      title: 'Multi',
      snippet: 'foo',
      tags: 'a,b,c',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
    }
    expect(rowToSearchResult(row).tags).toEqual(['a', 'b', 'c'])
  })
})
