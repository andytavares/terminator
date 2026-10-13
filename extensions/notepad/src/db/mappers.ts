import type { Note, Comment } from './types'

export type NoteRow = {
  id: string
  title: string
  body: string
  created_at: string
  updated_at: string
  archived_at: string | null
  tags: string | null
}

export type CommentRow = {
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
