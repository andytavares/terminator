export interface Note {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  tags: string[]
}

export interface NoteListItem {
  id: string
  title: string
  updatedAt: string
  createdAt: string
  archivedAt: string | null
  tags: string[]
  bodyPreview: string
}

export interface Tag {
  id: string
  name: string
  noteCount: number
}

export interface Comment {
  id: string
  noteId: string
  parentId: string | null
  body: string
  author: string
  status: 'open' | 'resolved' | 'orphaned'
  startOffset: number | null
  endOffset: number | null
  quote: string | null
  prefix: string | null
  suffix: string | null
  createdAt: string
  updatedAt: string
  replies: Comment[]
}

export interface SearchResult {
  id: string
  title: string
  snippet: string
  tags: string[]
  updatedAt: string
  archivedAt: string | null
}

export interface ExportFrontmatter {
  id: string
  title: string
  tags: string[]
  created: string
  updated: string
}
