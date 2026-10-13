import { z } from 'zod'
import { randomUUID } from '../db/db'
import { noPayload, type ExtensionDB, type ExtensionAPI } from '@terminator/extension-sdk'
import { createIpcRegistrar, IdPayload } from './register'
import { rowToNote, type NoteRow } from '../db/mappers'
import { noteTitle } from '../db/note-title'

/** Upserts the tags and makes them the note's whole tag set; safe within an open transaction. */
export async function reconcileTags(
  db: ExtensionDB,
  noteId: string,
  tagNames: string[]
): Promise<void> {
  const normalized = tagNames.map((t) => t.toLowerCase().trim()).filter(Boolean)

  const tagIds: string[] = []
  for (const name of normalized) {
    let row = await db.get<{ id: string }>('SELECT id FROM tags WHERE name=?', [name])
    if (!row) {
      const id = randomUUID()
      await db.run('INSERT INTO tags (id, name) VALUES (?, ?)', [id, name])
      row = { id }
    }
    tagIds.push(row.id)
  }

  await db.run('DELETE FROM note_tags WHERE note_id=?', [noteId])
  for (const tagId of tagIds) {
    await db.run('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [
      noteId,
      tagId,
    ])
  }
}

// ---- Exported handler functions for testing ----

const CreateNotePayload = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict()
  .default({})

/** @internal */
export async function createNote(
  db: ExtensionDB,
  args: z.infer<typeof CreateNotePayload>
): Promise<Record<string, unknown>> {
  const body = args.body ?? ''
  const title = args.title?.trim() || noteTitle(body)
  const id = randomUUID()
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, title, body, now, now]
    )
    await reconcileTags(tx, id, args.tags ?? [])
  })

  return { data: { id, title, createdAt: now } }
}

const ListNotesPayload = z
  .object({
    tagId: z.string().optional(),
    includeArchived: z.boolean().optional(),
    sortBy: z.enum(['updated_at', 'created_at', 'title']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .default({})

type NoteListRow = {
  id: string
  title: string
  updated_at: string
  created_at: string
  archived_at: string | null
  body: string
  tags: string
  sort_order: number
  folder_id: string | null
}

/** @internal */
export async function listNotes(
  db: ExtensionDB,
  args: z.infer<typeof ListNotesPayload>
): Promise<Record<string, unknown>> {
  const { tagId, includeArchived = false, sortBy = 'updated_at', sortDir = 'desc' } = args

  const archivedFilter = includeArchived ? '' : 'AND n.archived_at IS NULL'
  const tagFilter = tagId
    ? 'AND EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ?)'
    : ''
  const params: unknown[] = tagId ? [tagId] : []

  const rows = await db.query<NoteListRow>(
    `SELECT n.id, n.title, n.updated_at, n.created_at, n.archived_at,
            n.body,
            COALESCE(n.sort_order, 0) AS sort_order,
            n.folder_id,
            COALESCE((
              SELECT GROUP_CONCAT(t.name, ',')
              FROM tags t JOIN note_tags nt2 ON nt2.tag_id = t.id
              WHERE nt2.note_id = n.id
            ), '') AS tags
     FROM notes n
     WHERE 1=1 ${tagFilter} ${archivedFilter}
     ORDER BY COALESCE(n.sort_order, 0) ASC, ${noteListOrder(sortBy, sortDir)}`,
    params
  )
  return { data: rows.map(toNoteListItem) }
}

const NOTE_SORT_COLUMNS = ['title', 'created_at', 'updated_at']

/** An unknown column sorts by last update; any direction but ascending is descending. */
function noteListOrder(sortBy: string, sortDir: string): string {
  let orderCol = 'updated_at'
  if (NOTE_SORT_COLUMNS.includes(sortBy)) orderCol = sortBy
  if (sortDir === 'asc') return `n.${orderCol} ASC`
  return `n.${orderCol} DESC`
}

function toNoteListItem(r: NoteListRow) {
  return {
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    tags: splitTagNames(r.tags),
    bodyPreview: r.body.slice(0, 120),
    sortOrder: r.sort_order ?? 0,
    folderId: r.folder_id ?? null,
  }
}

/** The comma-joined tag names a GROUP_CONCAT produced, as a list. */
function splitTagNames(tags: string): string[] {
  if (!tags) return []
  return tags.split(',').filter(Boolean)
}

/** @internal */
export async function getNote(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const row = await db.get<NoteRow>(
    `SELECT n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at,
            COALESCE((
              SELECT GROUP_CONCAT(t.name, ',')
              FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
              WHERE nt.note_id = n.id
            ), '') AS tags
     FROM notes n WHERE n.id=?`,
    [args.id]
  )
  if (!row) return { error: 'NOTE_NOT_FOUND' }

  return { data: rowToNote(row) }
}

const AutosaveNotePayload = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  // Identifies the renderer that saved, so it can ignore the echo of its own
  // write instead of stomping on newer keystrokes.
  originId: z.string().optional(),
  // True when the user typed the title; from then on it is no longer derived from the body.
  titleSetByHand: z.boolean().optional(),
})

/**
 * Push channel announcing a saved note body to every open notepad surface.
 * @internal
 */
export const NOTES_CHANGED_CHANNEL = 'terminator.notepad:notes.changed'

type NotesBroadcast = (channel: string, data: unknown) => void
/**
 * The title to store: one set by hand now or before wins over the one the
 * renderer derived from the body.
 */
async function titleToStore(
  tx: ExtensionDB,
  args: z.infer<typeof AutosaveNotePayload>
): Promise<string> {
  if (args.titleSetByHand) {
    await tx.run('UPDATE notes SET title_set_by_hand=1 WHERE id=?', [args.id])
    return args.title
  }
  const row = await tx.get<{ title: string; title_set_by_hand: number }>(
    'SELECT title, title_set_by_hand FROM notes WHERE id=?',
    [args.id]
  )
  return row?.title_set_by_hand ? row.title : args.title
}

/** The note's tags with the inline #tags written in its body. */
function withInlineTags(tags: string[], body: string): string[] {
  const inlineTags = Array.from(body.matchAll(/#([a-z0-9_-]+)/gi), (m) => m[1])
  return Array.from(new Set([...tags, ...inlineTags]))
}

/** Writes the note's title, body and tags; answers the title and tags it stored. */
async function saveNote(
  db: ExtensionDB,
  args: z.infer<typeof AutosaveNotePayload>,
  now: string
): Promise<{ title: string; tags: string[] }> {
  const tags = withInlineTags(args.tags, args.body)
  let title = args.title
  await db.transaction(async (tx) => {
    title = await titleToStore(tx, args)
    await tx.run('UPDATE notes SET title=?, body=?, updated_at=? WHERE id=?', [
      title,
      args.body,
      now,
      args.id,
    ])
    await reconcileTags(tx, args.id, tags)
  })
  return { title, tags }
}

/** @internal */
export async function autosaveNote(
  db: ExtensionDB,
  args: z.infer<typeof AutosaveNotePayload>,
  broadcast?: NotesBroadcast
): Promise<Record<string, unknown>> {
  const { id, body, originId } = args
  const now = new Date().toISOString()

  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [id])
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  const { title, tags: mergedTags } = await saveNote(db, args, now)

  // The docked panel and a popped-out note window are separate renderers with
  // separate in-memory body caches. Without this push each keeps serving (and
  // re-saving) its own stale copy, so the same note shows different content.
  const changed = { id, title, body, tags: mergedTags, updatedAt: now, originId: originId ?? null }
  broadcast?.(NOTES_CHANGED_CHANNEL, changed)

  return { data: { updatedAt: now, title } }
}

/** @internal */
export async function archiveNote(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const archivedAt = new Date().toISOString()

  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [args.id])
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  await db.run('UPDATE notes SET archived_at=? WHERE id=?', [archivedAt, args.id])

  return { data: { archivedAt } }
}

/** @internal */
export async function restoreNote(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString()

  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [args.id])
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  await db.run('UPDATE notes SET archived_at=NULL, updated_at=? WHERE id=?', [now, args.id])

  return { data: { ok: true } }
}

/** @internal */
export async function hardDeleteNote(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [args.id])
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  await db.run('DELETE FROM notes WHERE id=?', [args.id])

  return { data: { ok: true } }
}

// ---- Tags IPC handlers ----

/** @internal */
export async function listTags(db: ExtensionDB): Promise<Record<string, unknown>> {
  const rows = await db.query<{ id: string; name: string; note_count: number }>(
    `SELECT t.id, t.name, COUNT(nt.note_id) AS note_count
     FROM tags t
     LEFT JOIN note_tags nt ON nt.tag_id = t.id
     GROUP BY t.id, t.name
     ORDER BY t.name ASC`
  )

  return {
    data: rows.map((r) => ({ id: r.id, name: r.name, noteCount: r.note_count })),
  }
}

const RenameTagPayload = z.object({ id: z.string(), name: z.string().min(1) })

/** @internal */
export async function renameTag(
  db: ExtensionDB,
  args: z.infer<typeof RenameTagPayload>
): Promise<Record<string, unknown>> {
  await db.run('UPDATE tags SET name=? WHERE id=?', [args.name.toLowerCase().trim(), args.id])
  return { data: { ok: true } }
}

/** @internal */
export async function deleteTag(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  await db.run('DELETE FROM tags WHERE id=?', [args.id])
  return { data: { ok: true } }
}

export function registerTagsIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handleRemote, cleanup } = createIpcRegistrar(api)
  handleRemote('terminator.notepad:tags.list', noPayload, () => listTags(db))
  handleRemote('terminator.notepad:tags.rename', RenameTagPayload, (args) => renameTag(db, args))
  handleRemote('terminator.notepad:tags.delete', IdPayload, (args) => deleteTag(db, args))

  return cleanup
}

const ReorderItemsPayload = z.object({
  items: z.array(z.object({ id: z.string(), type: z.enum(['note', 'diagram']) })),
})

/** @internal */
export async function reorderItems(
  db: ExtensionDB,
  args: z.infer<typeof ReorderItemsPayload>
): Promise<Record<string, unknown>> {
  const { items } = args

  const TABLE_MAP = { note: 'notes', diagram: 'diagrams' } as const
  await db.transaction(async (tx) => {
    for (let i = 0; i < items.length; i++) {
      const { id, type } = items[i]
      const table = TABLE_MAP[type]
      await tx.run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [i, id])
    }
  })

  return { data: { ok: true } }
}

// ---- IPC Registration ----

export function registerNotesIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handleRemote, cleanup } = createIpcRegistrar(api)
  const broadcast = (channel: string, data: unknown) => api.window.broadcast(channel, data)
  handleRemote('terminator.notepad:notes.create', CreateNotePayload, (args) => createNote(db, args))
  handleRemote('terminator.notepad:notes.list', ListNotesPayload, (args) => listNotes(db, args))
  handleRemote('terminator.notepad:notes.get', IdPayload, (args) => getNote(db, args))
  handleRemote('terminator.notepad:notes.autosave', AutosaveNotePayload, (args) =>
    autosaveNote(db, args, broadcast)
  )
  handleRemote('terminator.notepad:notes.archive', IdPayload, (args) => archiveNote(db, args))
  handleRemote('terminator.notepad:notes.restore', IdPayload, (args) => restoreNote(db, args))
  handleRemote('terminator.notepad:notes.hardDelete', IdPayload, (args) => hardDeleteNote(db, args))
  handleRemote('terminator.notepad:notes.reorder', ReorderItemsPayload, (args) =>
    reorderItems(db, args)
  )

  return cleanup
}
