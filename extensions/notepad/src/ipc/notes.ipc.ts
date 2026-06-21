import { ipcMain, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { z } from 'zod'
import { randomUUID } from '../db/db'
import type { ExtensionDB } from '../../../../src/main/db/index'

const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

function deriveTitle(body: string): string {
  const headingMatch = /^#{1,6}\s+(.+)/m.exec(body)
  if (headingMatch) return headingMatch[1].trim()
  const firstLine = body.split('\n').find((l) => l.trim().length > 0)
  if (firstLine) return firstLine.trim().slice(0, 120)
  return 'Untitled note'
}

async function reconcileTags(db: ExtensionDB, noteId: string, tagNames: string[]): Promise<void> {
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

export async function createNote(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .strict()

  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) return VALIDATION_ERROR

  const body = parsed.data.body ?? ''
  const title = parsed.data.title?.trim() || deriveTitle(body)
  const id = randomUUID()
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, title, body, now, now]
    )
    await reconcileTags(tx, id, parsed.data.tags ?? [])
  })

  return { data: { id, title, createdAt: now } }
}

export async function listNotes(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({
    tagId: z.string().optional(),
    includeArchived: z.boolean().optional(),
    sortBy: z.enum(['updated_at', 'created_at', 'title']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })

  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) return VALIDATION_ERROR

  const { tagId, includeArchived = false, sortBy = 'updated_at', sortDir = 'desc' } = parsed.data

  const archivedFilter = includeArchived ? '' : 'AND n.archived_at IS NULL'
  const tagFilter = tagId
    ? 'AND EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ?)'
    : ''
  const orderCol = ['title', 'created_at', 'updated_at'].includes(sortBy) ? sortBy : 'updated_at'
  const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC'
  const params: unknown[] = tagId ? [tagId] : []

  const rows = await db.query<{
    id: string
    title: string
    updated_at: string
    created_at: string
    archived_at: string | null
    body: string
    tags: string
    sort_order: number
    folder_id: string | null
  }>(
    `SELECT n.id, n.title, n.updated_at, n.created_at, n.archived_at,
            n.body,
            COALESCE(n.sort_order, 0) AS sort_order,
            n.folder_id,
            COALESCE((
              SELECT STRING_AGG(t.name, ',')
              FROM tags t JOIN note_tags nt2 ON nt2.tag_id = t.id
              WHERE nt2.note_id = n.id
            ), '') AS tags
     FROM notes n
     WHERE 1=1 ${tagFilter} ${archivedFilter}
     ORDER BY COALESCE(n.sort_order, 0) ASC, n.${orderCol} ${orderDir}`,
    params
  )

  const data = rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
    bodyPreview: r.body.slice(0, 120),
    sortOrder: r.sort_order ?? 0,
    folderId: r.folder_id ?? null,
  }))

  return { data }
}

export async function getNote(db: ExtensionDB, payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const row = await db.get<{
    id: string
    title: string
    body: string
    created_at: string
    updated_at: string
    archived_at: string | null
    tags: string
  }>(
    `SELECT n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at,
            COALESCE((
              SELECT STRING_AGG(t.name, ',')
              FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
              WHERE nt.note_id = n.id
            ), '') AS tags
     FROM notes n WHERE n.id=?`,
    [parsed.data.id]
  )

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

export async function autosaveNote(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
  })

  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const { id, title, body, tags } = parsed.data
  const now = new Date().toISOString()

  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [id])
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  // Parse inline #tags from body and merge with explicit tags array
  const inlineTags = Array.from(body.matchAll(/#([a-z0-9_-]+)/gi), (m) => m[1])
  const mergedTags = Array.from(new Set([...tags, ...inlineTags]))

  await db.transaction(async (tx) => {
    await tx.run('UPDATE notes SET title=?, body=?, updated_at=? WHERE id=?', [
      title,
      body,
      now,
      id,
    ])
    await reconcileTags(tx, id, mergedTags)
  })

  return { data: { updatedAt: now } }
}

export async function archiveNote(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const archivedAt = new Date().toISOString()

  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [parsed.data.id])
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  await db.run('UPDATE notes SET archived_at=? WHERE id=?', [archivedAt, parsed.data.id])

  return { data: { archivedAt } }
}

export async function restoreNote(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const now = new Date().toISOString()

  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [parsed.data.id])
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  await db.run('UPDATE notes SET archived_at=NULL, updated_at=? WHERE id=?', [now, parsed.data.id])

  return { data: { ok: true } }
}

export async function hardDeleteNote(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [parsed.data.id])
  if (!existing) return { error: 'NOTE_NOT_FOUND' }

  await db.run('DELETE FROM notes WHERE id=?', [parsed.data.id])

  return { data: { ok: true } }
}

export async function openNoteInWindow(
  _db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (!mainWindow) return { error: 'NO_MAIN_WINDOW' }

  const baseUrl = mainWindow.webContents.getURL()
  const urlObj = new URL(baseUrl)
  urlObj.searchParams.set('view', 'notepad-note')
  urlObj.searchParams.set('noteId', parsed.data.id)
  const noteUrl = urlObj.toString()

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

export async function listTags(
  db: ExtensionDB,
  _payload: unknown
): Promise<Record<string, unknown>> {
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

export async function renameTag(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string(), name: z.string().min(1) })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  await db.run('UPDATE tags SET name=? WHERE id=?', [
    parsed.data.name.toLowerCase().trim(),
    parsed.data.id,
  ])
  return { data: { ok: true } }
}

export async function deleteTag(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  await db.run('DELETE FROM tags WHERE id=?', [parsed.data.id])
  return { data: { ok: true } }
}

export function registerTagsIpcHandlers(db: ExtensionDB): () => void {
  ipcMain.handle('terminator.notepad:tags.list', (_, payload) => listTags(db, payload))
  ipcMain.handle('terminator.notepad:tags.rename', (_, payload) => renameTag(db, payload))
  ipcMain.handle('terminator.notepad:tags.delete', (_, payload) => deleteTag(db, payload))

  return () => {
    ipcMain.removeHandler('terminator.notepad:tags.list')
    ipcMain.removeHandler('terminator.notepad:tags.rename')
    ipcMain.removeHandler('terminator.notepad:tags.delete')
  }
}

export async function reorderItems(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({
    items: z.array(z.object({ id: z.string(), type: z.enum(['note', 'diagram']) })),
  })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const { items } = parsed.data

  await db.transaction(async (tx) => {
    for (let i = 0; i < items.length; i++) {
      const { id, type } = items[i]
      const table = type === 'diagram' ? 'diagrams' : 'notes'
      await tx.run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [i, id])
    }
  })

  return { data: { ok: true } }
}

// ---- IPC Registration ----

export function registerNotesIpcHandlers(db: ExtensionDB): () => void {
  ipcMain.handle('terminator.notepad:notes.create', (_, payload) => createNote(db, payload))
  ipcMain.handle('terminator.notepad:notes.list', (_, payload) => listNotes(db, payload))
  ipcMain.handle('terminator.notepad:notes.get', (_, payload) => getNote(db, payload))
  ipcMain.handle('terminator.notepad:notes.autosave', (_, payload) => autosaveNote(db, payload))
  ipcMain.handle('terminator.notepad:notes.archive', (_, payload) => archiveNote(db, payload))
  ipcMain.handle('terminator.notepad:notes.restore', (_, payload) => restoreNote(db, payload))
  ipcMain.handle('terminator.notepad:notes.hardDelete', (_, payload) => hardDeleteNote(db, payload))
  ipcMain.handle('terminator.notepad:notes.openWindow', (_, payload) =>
    openNoteInWindow(db, payload)
  )
  ipcMain.handle('terminator.notepad:notes.reorder', (_, payload) => reorderItems(db, payload))

  return () => {
    ipcMain.removeHandler('terminator.notepad:notes.create')
    ipcMain.removeHandler('terminator.notepad:notes.list')
    ipcMain.removeHandler('terminator.notepad:notes.get')
    ipcMain.removeHandler('terminator.notepad:notes.autosave')
    ipcMain.removeHandler('terminator.notepad:notes.archive')
    ipcMain.removeHandler('terminator.notepad:notes.restore')
    ipcMain.removeHandler('terminator.notepad:notes.hardDelete')
    ipcMain.removeHandler('terminator.notepad:notes.openWindow')
    ipcMain.removeHandler('terminator.notepad:notes.reorder')
  }
}
