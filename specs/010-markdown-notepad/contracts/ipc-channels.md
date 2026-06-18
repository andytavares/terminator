# IPC Channels: Markdown Notepad Extension

**Extension ID**: `terminator.notepad`  
**Channel prefix**: `terminator.notepad:`  
**Date**: 2026-06-18  
**API Version**: ExtensionAPI v1.3.0

All channels are registered by the extension's main process via `api.ipc.registerHandler(channel, handler)`. The renderer calls them via `window.electronAPI.ipc.invoke(channel, payload)`. Every handler returns `{ data }` on success or `{ error: string }` on failure (never throws to the renderer).

---

## Notes

### `terminator.notepad:notes.list`

List notes, optionally filtered and sorted.

**Request**:

```typescript
{
  tagId?: string          // filter by tag UUID
  includeArchived?: boolean // default false
  sortBy?: 'updated_at' | 'created_at' | 'title'  // default 'updated_at'
  sortDir?: 'asc' | 'desc'  // default 'desc'
}
```

**Response**:

```typescript
{
  data: Array<{
    id: string
    title: string
    updatedAt: string
    createdAt: string
    archivedAt: string | null
    tags: string[]
    bodyPreview: string // first 120 chars of body
  }>
}
```

---

### `terminator.notepad:notes.get`

Get a single note by ID including full body.

**Request**: `{ id: string }`

**Response**:

```typescript
{
  data: {
    id: string
    title: string
    body: string
    createdAt: string
    updatedAt: string
    archivedAt: string | null
    tags: string[]
  }
}
```

---

### `terminator.notepad:notes.create`

Create a new note.

**Request**:

```typescript
{
  title?: string    // derived from body if omitted; defaults to 'Untitled note'
  body?: string     // default ''
  tags?: string[]   // tag names; new tags are created automatically
}
```

**Response**: `{ data: { id: string; title: string; createdAt: string } }`

---

### `terminator.notepad:notes.autosave`

Debounced autosave from the editor (body + derived title update).

**Request**:

```typescript
{
  id: string
  title: string
  body: string
  tags: string[]    // reconciled tag set (names)
}
```

**Response**: `{ data: { updatedAt: string } }`

---

### `terminator.notepad:notes.archive`

Soft-delete a note (sets `archived_at`).

**Request**: `{ id: string }`  
**Response**: `{ data: { archivedAt: string } }`

---

### `terminator.notepad:notes.restore`

Restore an archived note (clears `archived_at`).

**Request**: `{ id: string }`  
**Response**: `{ data: { ok: true } }`

---

### `terminator.notepad:notes.hardDelete`

Permanently delete a note and all its comments. Requires prior user confirmation in the renderer.

**Request**: `{ id: string }`  
**Response**: `{ data: { ok: true } }`

---

## Tags

### `terminator.notepad:tags.list`

List all tags with note counts.

**Request**: `{}`  
**Response**: `{ data: Array<{ id: string; name: string; noteCount: number }> }`

---

### `terminator.notepad:tags.rename`

Rename a tag globally.

**Request**: `{ id: string; name: string }`  
**Response**: `{ data: { ok: true } }`

---

### `terminator.notepad:tags.delete`

Delete a tag and remove it from all notes (notes are not deleted).

**Request**: `{ id: string }`  
**Response**: `{ data: { ok: true } }`

---

## Comments

### `terminator.notepad:comments.list`

List all comments for a note (top-level + replies nested under parent).

**Request**: `{ noteId: string; includeResolved?: boolean }`  
**Response**:

```typescript
{
  data: Array<{
    id: string
    noteId: string
    parentId: null // top-level only in this array
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
    replies: Array<{
      // flat, no further nesting
      id: string
      parentId: string
      body: string
      author: string
      status: string
      createdAt: string
      updatedAt: string
    }>
  }>
}
```

---

### `terminator.notepad:comments.create`

Create a top-level comment anchored to a text selection.

**Request**:

```typescript
{
  noteId: string
  body: string
  startOffset: number
  endOffset: number
  quote: string
  prefix: string
  suffix: string
}
```

**Response**: `{ data: { id: string; createdAt: string } }`

---

### `terminator.notepad:comments.reply`

Add a reply to a top-level comment (max depth 2 enforced: returns `{ error }` if `parentId` refers to a reply).

**Request**:

```typescript
{
  noteId: string
  parentId: string // must be a top-level comment ID
  body: string
}
```

**Response**: `{ data: { id: string; createdAt: string } }`

---

### `terminator.notepad:comments.update`

Edit the body of an existing comment.

**Request**: `{ id: string; body: string }`  
**Response**: `{ data: { updatedAt: string } }`

---

### `terminator.notepad:comments.delete`

Delete a comment. Replies are cascade-deleted.

**Request**: `{ id: string }`  
**Response**: `{ data: { ok: true } }`

---

### `terminator.notepad:comments.resolve`

Toggle resolved/open status.

**Request**: `{ id: string; resolved: boolean }`  
**Response**: `{ data: { status: 'open' | 'resolved' } }`

---

### `terminator.notepad:comments.updateAnchor`

Persist remapped anchor offsets after CM6 ChangeSet mapping (debounced, ~2 s idle).

**Request**:

```typescript
{
  id: string
  startOffset: number
  endOffset: number
}
```

**Response**: `{ data: { ok: true } }`

---

### `terminator.notepad:comments.markOrphaned`

Mark a comment orphaned when re-anchoring fails on note load.

**Request**: `{ id: string }`  
**Response**: `{ data: { ok: true } }`

---

## Search

### `terminator.notepad:search.query`

Full-text search across notes using FTS5 + BM25 ranking.

**Request**:

```typescript
{
  query: string           // raw search string; may include tag: / -tag: tokens
  includeArchived?: boolean  // default false
  limit?: number          // default 50
}
```

**Response**:

```typescript
{
  data: Array<{
    id: string
    title: string
    snippet: string // HTML with <mark>…</mark> highlights
    tags: string[]
    updatedAt: string
    archivedAt: string | null
  }>
}
```

---

## Export / Import

### `terminator.notepad:export.pickFolder`

Open the OS folder picker dialog.

**Request**: `{}`  
**Response**: `{ data: { path: string } }` or `{ data: null }` if cancelled

---

### `terminator.notepad:export.run`

Export notes to a folder.

**Request**:

```typescript
{
  folderPath: string
  scope: 'all' | 'note' | 'tag'
  noteId?: string      // required when scope='note'
  tagId?: string       // required when scope='tag'
  exportComments: 'sidecar' | 'inline' | 'both'  // default 'sidecar'
}
```

**Response**: `{ data: { exported: number; folderPath: string } }`

---

### `terminator.notepad:import.run`

Import `.md` files from a folder. Updates existing notes matched by frontmatter `id`; creates new notes for unmatched files.

**Request**: `{ folderPath: string }`  
**Response**: `{ data: { created: number; updated: number; skipped: number } }`
