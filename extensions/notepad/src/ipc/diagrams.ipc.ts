import { ipcMain } from 'electron'
import { z } from 'zod'
import { getDb, randomUUID } from '../db/db'

const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

export async function createDiagram(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z
    .object({
      title: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .strict()
  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  const title = parsed.data.title?.trim() || 'Untitled diagram'
  const tags = JSON.stringify(parsed.data.tags ?? [])

  db.prepare(
    `INSERT INTO diagrams (id, title, tags, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, title, tags, '{}', now, now)

  return { data: { id, title, createdAt: now } }
}

export async function listDiagrams(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ includeArchived: z.boolean().optional() })
  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) return VALIDATION_ERROR

  const { includeArchived = false } = parsed.data
  const db = getDb()

  const archivedFilter = includeArchived ? '' : 'AND archived_at IS NULL'
  const rows = db
    .prepare(
      `SELECT id, title, tags, created_at, updated_at, archived_at
       FROM diagrams
       WHERE 1=1 ${archivedFilter}
       ORDER BY updated_at DESC, rowid DESC`
    )
    .all() as {
    id: string
    title: string
    tags: string
    created_at: string
    updated_at: string
    archived_at: string | null
  }[]

  return {
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      tags: (() => {
        try {
          return JSON.parse(r.tags ?? '[]') as string[]
        } catch {
          return []
        }
      })(),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: r.archived_at,
      type: 'diagram' as const,
    })),
  }
}

export async function getDiagram(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, title, tags, scene_json, created_at, updated_at, archived_at FROM diagrams WHERE id=?`
    )
    .get(parsed.data.id) as
    | {
        id: string
        title: string
        tags: string
        scene_json: string
        created_at: string
        updated_at: string
        archived_at: string | null
      }
    | undefined

  if (!row) return { error: 'DIAGRAM_NOT_FOUND' }

  return {
    data: {
      id: row.id,
      title: row.title,
      tags: (() => {
        try {
          return JSON.parse(row.tags ?? '[]') as string[]
        } catch {
          return []
        }
      })(),
      sceneJson: row.scene_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    },
  }
}

export async function autosaveDiagram(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({
    id: z.string(),
    title: z.string(),
    sceneJson: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const { id, title, sceneJson } = parsed.data
  const db = getDb()
  const now = new Date().toISOString()

  const existing = db.prepare('SELECT id FROM diagrams WHERE id=?').get(id)
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  const tags = JSON.stringify(parsed.data.tags ?? [])
  if (sceneJson !== undefined) {
    db.prepare('UPDATE diagrams SET title=?, tags=?, scene_json=?, updated_at=? WHERE id=?').run(
      title.trim() || 'Untitled diagram',
      tags,
      sceneJson,
      now,
      id
    )
  } else {
    db.prepare('UPDATE diagrams SET title=?, tags=?, updated_at=? WHERE id=?').run(
      title.trim() || 'Untitled diagram',
      tags,
      now,
      id
    )
  }

  return { data: { updatedAt: now } }
}

export async function archiveDiagram(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const archivedAt = new Date().toISOString()
  const existing = db.prepare('SELECT id FROM diagrams WHERE id=?').get(parsed.data.id)
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  db.prepare('UPDATE diagrams SET archived_at=? WHERE id=?').run(archivedAt, parsed.data.id)
  return { data: { archivedAt } }
}

export async function restoreDiagram(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const now = new Date().toISOString()
  const existing = db.prepare('SELECT id FROM diagrams WHERE id=?').get(parsed.data.id)
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  db.prepare('UPDATE diagrams SET archived_at=NULL, updated_at=? WHERE id=?').run(
    now,
    parsed.data.id
  )
  return { data: { ok: true } }
}

export async function hardDeleteDiagram(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const existing = db.prepare('SELECT id FROM diagrams WHERE id=?').get(parsed.data.id)
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  db.prepare('DELETE FROM diagrams WHERE id=?').run(parsed.data.id)
  return { data: { ok: true } }
}

export function registerDiagramsIpcHandlers(): () => void {
  ipcMain.handle('terminator.notepad:diagrams.create', (_, payload) => createDiagram(payload))
  ipcMain.handle('terminator.notepad:diagrams.list', (_, payload) => listDiagrams(payload))
  ipcMain.handle('terminator.notepad:diagrams.get', (_, payload) => getDiagram(payload))
  ipcMain.handle('terminator.notepad:diagrams.autosave', (_, payload) => autosaveDiagram(payload))
  ipcMain.handle('terminator.notepad:diagrams.archive', (_, payload) => archiveDiagram(payload))
  ipcMain.handle('terminator.notepad:diagrams.restore', (_, payload) => restoreDiagram(payload))
  ipcMain.handle('terminator.notepad:diagrams.hardDelete', (_, payload) =>
    hardDeleteDiagram(payload)
  )

  return () => {
    ipcMain.removeHandler('terminator.notepad:diagrams.create')
    ipcMain.removeHandler('terminator.notepad:diagrams.list')
    ipcMain.removeHandler('terminator.notepad:diagrams.get')
    ipcMain.removeHandler('terminator.notepad:diagrams.autosave')
    ipcMain.removeHandler('terminator.notepad:diagrams.archive')
    ipcMain.removeHandler('terminator.notepad:diagrams.restore')
    ipcMain.removeHandler('terminator.notepad:diagrams.hardDelete')
  }
}
