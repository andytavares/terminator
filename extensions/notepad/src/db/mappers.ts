import type { Note, Tag, Comment, SearchResult } from './types'

interface NoteRow {
  id: string
  title: string
  body: string
  created_at: string
  updated_at: string
  archived_at: string | null
  tags: string | null
}

interface TagRow {
  id: string
  name: string
  note_count: number
}

interface CommentRow {
  id: string
  note_id: string
  parent_id: string | null
  body: string
  author: string
  status: string
  start_offset: number | null
  end_offset: number | null
  quote: string | null
  prefix: string | null
  suffix: string | null
  created_at: string
  updated_at: string
}

interface SearchResultRow {
  id: string
  title: string
  snippet: string
  tags: string | null
  updated_at: string
  archived_at: string | null
}

export function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
  }
}

export function rowToTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, noteCount: row.note_count }
}

export function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    noteId: row.note_id,
    parentId: row.parent_id,
    body: row.body,
    author: row.author,
    status: row.status as 'open' | 'resolved' | 'orphaned',
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    quote: row.quote,
    prefix: row.prefix,
    suffix: row.suffix,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    replies: [],
  }
}

export function rowToSearchResult(row: SearchResultRow): SearchResult {
  return {
    id: row.id,
    title: row.title,
    snippet: row.snippet,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}
