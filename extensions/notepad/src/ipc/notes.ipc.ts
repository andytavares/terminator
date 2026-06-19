import { ipcMain, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { z } from 'zod'
import { getDb, randomUUID, insertFts, deleteFts } from '../db/db'

const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

function deriveTitle(body: string): string {
  const headingMatch = /^#{1,6}\s+(.+)/m.exec(body)
  if (headingMatch) return headingMatch[1].trim()
  const firstLine = body.split('\n').find((l) => l.trim().length > 0)
  if (firstLine) return firstLine.trim().slice(0, 120)
  return 'Untitled note'
}

function reconcileTags(db: ReturnType<typeof getDb>, noteId: string, tagNames: string[]): void {
  const now = new Date().toISOString()
  const normalized = tagNames.map((t) => t.toLowerCase().trim()).filter(Boolean)

  const tagIds: string[] = []
  for (const name of normalized) {
    let row = db.prepare('SELECT id FROM tags WHERE name=?').get(name) as { id: string } | undefined
    if (!row) {
      const id = randomUUID()
      db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, name)
      row = { id }
    }
    tagIds.push(row.id)
  }

  db.prepare('DELETE FROM note_tags WHERE note_id=?').run(noteId)
  for (const tagId of tagIds) {
    db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tagId)
  }

  void now // satisfies linter
}

function getTagNamesForNote(db: ReturnType<typeof getDb>, noteId: string): string {
  const rows = db
    .prepare(
      `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name`
    )
    .all(noteId) as { name: string }[]
  return rows.map((r) => r.name).join(',')
}

// ---- Exported handler functions for testing ----

export async function createNote(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .strict()

  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const body = parsed.data.body ?? ''
  const title = parsed.data.title?.trim() || deriveTitle(body)
  const id = randomUUID()
  const now = new Date().toISOString()

  db.transaction(() => {
    db.prepare(
      `INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(id, title, body, now, now)

    reconcileTags(db, id, parsed.data.tags ?? [])

    const noteRow = db.prepare('SELECT rowid FROM notes WHERE id=?').get(id) as { rowid: number }
    const tagNames = getTagNamesForNote(db, id)
    insertFts(db, noteRow.rowid, title, body, tagNames)
  })()

  return { data: { id, title, createdAt: now } }
}

export async function listNotes(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({
    tagId: z.string().optional(),
    includeArchived: z.boolean().optional(),
    sortBy: z.enum(['updated_at', 'created_at', 'title']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })

  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) return VALIDATION_ERROR

  const { tagId, includeArchived = false, sortBy = 'updated_at', sortDir = 'desc' } = parsed.data
  const db = getDb()

  const archivedFilter = includeArchived ? '' : 'AND n.archived_at IS NULL'
  const tagFilter = tagId
    ? 'AND EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ?)'
    : ''
  const orderCol = ['title', 'created_at', 'updated_at'].includes(sortBy) ? sortBy : 'updated_at'
  const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC'
  const params: unknown[] = tagId ? [tagId] : []

  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.updated_at, n.created_at, n.archived_at,
              n.body,
              COALESCE((
                SELECT GROUP_CONCAT(t.name, ',')
                FROM tags t JOIN note_tags nt2 ON nt2.tag_id = t.id
                WHERE nt2.note_id = n.id
              ), '') AS tags
       FROM notes n
       WHERE 1=1 ${tagFilter} ${archivedFilter}
       ORDER BY n.${orderCol} ${orderDir}`
    )
    .all(...params) as {
    id: string
    title: string
    updated_at: string
    created_at: string
    archived_at: string | null
    body: string
    tags: string
  }[]

  const data = rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
    bodyPreview: r.body.slice(0, 120),
  }))

  return { data }
}

export async function getNote(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const row = db
    .prepare(
      `SELECT n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at,
              COALESCE((
                SELECT GROUP_CONCAT(t.name, ',')
                FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
                WHERE nt.note_id = n.id
              ), '') AS tags
       FROM notes n WHERE n.id=?`
    )
    .get(parsed.data.id) as
    | {
        id: string
        title: string
        body: string
        created_at: string
        updated_at: string
        archived_at: string | null
        tags: string
      }
    | undefined

  if (!row) return { error: 'NOTE_NOT_FOUND' }

  return {
    data: {
      id: row.id,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    },
  }
}

export async function autosaveNote(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
  })

  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const { id, title, body, tags } = parsed.data
  const db = getDb()
  const now = new Date().toISOString()

  const existing = db.prepare('SELECT rowid FROM notes WHERE id=?').get(id) as
    | { rowid: number }
    | undefined
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  // Parse inline #tags from body and merge with explicit tags array
  const inlineTags = Array.from(body.matchAll(/#([a-z0-9_-]+)/gi), (m) => m[1])
  const mergedTags = Array.from(new Set([...tags, ...inlineTags]))

  db.transaction(() => {
    db.prepare('UPDATE notes SET title=?, body=?, updated_at=? WHERE id=?').run(
      title,
      body,
      now,
      id
    )
    reconcileTags(db, id, mergedTags)
    const tagNames = getTagNamesForNote(db, id)
    insertFts(db, existing.rowid, title, body, tagNames)
  })()

  return { data: { updatedAt: now } }
}

export async function archiveNote(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const archivedAt = new Date().toISOString()

  const existing = db.prepare('SELECT rowid FROM notes WHERE id=?').get(parsed.data.id) as
    | { rowid: number }
    | undefined
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  db.transaction(() => {
    db.prepare('UPDATE notes SET archived_at=? WHERE id=?').run(archivedAt, parsed.data.id)
    deleteFts(db, existing.rowid)
  })()

  return { data: { archivedAt } }
}

export async function restoreNote(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const now = new Date().toISOString()

  const existing = db
    .prepare('SELECT rowid, title, body FROM notes WHERE id=?')
    .get(parsed.data.id) as { rowid: number; title: string; body: string } | undefined
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  db.transaction(() => {
    db.prepare('UPDATE notes SET archived_at=NULL, updated_at=? WHERE id=?').run(
      now,
      parsed.data.id
    )
    const tagNames = getTagNamesForNote(db, parsed.data.id)
    insertFts(db, existing.rowid, existing.title, existing.body, tagNames)
  })()

  return { data: { ok: true } }
}

export async function hardDeleteNote(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const existing = db.prepare('SELECT rowid FROM notes WHERE id=?').get(parsed.data.id) as
    | { rowid: number }
    | undefined
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  db.transaction(() => {
    deleteFts(db, existing.rowid)
    db.prepare('DELETE FROM notes WHERE id=?').run(parsed.data.id)
  })()

  return { data: { ok: true } }
}

export async function openNoteInWindow(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (!mainWindow) return { error: 'NO_MAIN_WINDOW' }

  // Build a standalone URL with view=notepad-note so only the note editor renders
  const baseUrl = mainWindow.webContents.getURL()
  const urlObj = new URL(baseUrl)
  urlObj.searchParams.set('view', 'notepad-note')
  urlObj.searchParams.set('noteId', parsed.data.id)
  const noteUrl = urlObj.toString()

  // electron-vite builds preload to out/preload/index.js (mirrors package.json "main")
  const preload = join(app.getAppPath(), 'out', 'preload', 'index.js')

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win
    .loadURL(noteUrl)
    .catch((err) => console.error('[notepad] openNoteInWindow: failed to load', err))

  return { data: { ok: true } }
}

// ---- Tags IPC handlers ----

export async function listTags(_payload: unknown): Promise<Record<string, unknown>> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT t.id, t.name, COUNT(nt.note_id) AS note_count
       FROM tags t
       LEFT JOIN note_tags nt ON nt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name ASC`
    )
    .all() as { id: string; name: string; note_count: number }[]

  return {
    data: rows.map((r) => ({ id: r.id, name: r.name, noteCount: r.note_count })),
  }
}

export async function renameTag(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string(), name: z.string().min(1) })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  db.prepare('UPDATE tags SET name=? WHERE id=?').run(
    parsed.data.name.toLowerCase().trim(),
    parsed.data.id
  )
  return { data: { ok: true } }
}

export async function deleteTag(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  db.prepare('DELETE FROM tags WHERE id=?').run(parsed.data.id)
  return { data: { ok: true } }
}

export function registerTagsIpcHandlers(): () => void {
  ipcMain.handle('terminator.notepad:tags.list', (_, payload) => listTags(payload))
  ipcMain.handle('terminator.notepad:tags.rename', (_, payload) => renameTag(payload))
  ipcMain.handle('terminator.notepad:tags.delete', (_, payload) => deleteTag(payload))

  return () => {
    ipcMain.removeHandler('terminator.notepad:tags.list')
    ipcMain.removeHandler('terminator.notepad:tags.rename')
    ipcMain.removeHandler('terminator.notepad:tags.delete')
  }
}

// ---- IPC Registration ----

export function registerNotesIpcHandlers(): () => void {
  ipcMain.handle('terminator.notepad:notes.create', (_, payload) => createNote(payload))
  ipcMain.handle('terminator.notepad:notes.list', (_, payload) => listNotes(payload))
  ipcMain.handle('terminator.notepad:notes.get', (_, payload) => getNote(payload))
  ipcMain.handle('terminator.notepad:notes.autosave', (_, payload) => autosaveNote(payload))
  ipcMain.handle('terminator.notepad:notes.archive', (_, payload) => archiveNote(payload))
  ipcMain.handle('terminator.notepad:notes.restore', (_, payload) => restoreNote(payload))
  ipcMain.handle('terminator.notepad:notes.hardDelete', (_, payload) => hardDeleteNote(payload))
  ipcMain.handle('terminator.notepad:notes.openWindow', (_, payload) => openNoteInWindow(payload))

  return () => {
    ipcMain.removeHandler('terminator.notepad:notes.create')
    ipcMain.removeHandler('terminator.notepad:notes.list')
    ipcMain.removeHandler('terminator.notepad:notes.get')
    ipcMain.removeHandler('terminator.notepad:notes.autosave')
    ipcMain.removeHandler('terminator.notepad:notes.archive')
    ipcMain.removeHandler('terminator.notepad:notes.restore')
    ipcMain.removeHandler('terminator.notepad:notes.hardDelete')
    ipcMain.removeHandler('terminator.notepad:notes.openWindow')
  }
}
