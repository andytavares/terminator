import { ipcMain, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { z } from 'zod'
import { randomUUID } from '../db/db'
import type { ExtensionDB } from '../../../../src/main/db/index'

const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

export async function createDiagram(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z
    .object({
      title: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .strict()
  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) return VALIDATION_ERROR

  const id = randomUUID()
  const now = new Date().toISOString()
  const title = parsed.data.title?.trim() || 'Untitled diagram'

  await db.run(
    `INSERT INTO diagrams (id, title, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, title, '{}', now, now]
  )
  for (const tag of parsed.data.tags ?? []) {
    await db.run(`INSERT INTO diagram_tags (diagram_id, tag) VALUES (?, ?)`, [id, tag])
  }

  return { data: { id, title, createdAt: now } }
}

export async function listDiagrams(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ includeArchived: z.boolean().optional() })
  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) return VALIDATION_ERROR

  const { includeArchived = false } = parsed.data

  const archivedFilter = includeArchived ? '' : 'AND archived_at IS NULL'
  const rows = await db.query<{
    id: string
    title: string
    created_at: string
    updated_at: string
    archived_at: string | null
    sort_order: number
    folder_id: string | null
  }>(
    `SELECT id, title, created_at, updated_at, archived_at, COALESCE(sort_order, 0) AS sort_order, folder_id
     FROM diagrams
     WHERE 1=1 ${archivedFilter}
     ORDER BY COALESCE(sort_order, 0) ASC, updated_at DESC`
  )

  const allTagRows = await db.query<{ diagram_id: string; tag: string }>(
    `SELECT diagram_id, tag FROM diagram_tags ORDER BY tag`
  )
  const tagsByDiagramId = new Map<string, string[]>()
  for (const t of allTagRows) {
    const arr = tagsByDiagramId.get(t.diagram_id) ?? []
    arr.push(t.tag)
    tagsByDiagramId.set(t.diagram_id, arr)
  }

  return {
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      tags: tagsByDiagramId.get(r.id) ?? [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: r.archived_at,
      type: 'diagram' as const,
      sortOrder: r.sort_order ?? 0,
      folderId: r.folder_id ?? null,
    })),
  }
}

export async function getDiagram(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const row = await db.get<{
    id: string
    title: string
    scene_json: string
    created_at: string
    updated_at: string
    archived_at: string | null
  }>(`SELECT id, title, scene_json, created_at, updated_at, archived_at FROM diagrams WHERE id=?`, [
    parsed.data.id,
  ])

  if (!row) return { error: 'DIAGRAM_NOT_FOUND' }

  const tagRows = await db.query<{ tag: string }>(
    `SELECT tag FROM diagram_tags WHERE diagram_id=? ORDER BY tag`,
    [parsed.data.id]
  )

  return {
    data: {
      id: row.id,
      title: row.title,
      tags: tagRows.map((t) => t.tag),
      sceneJson: row.scene_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    },
  }
}

export async function autosaveDiagram(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({
    id: z.string(),
    title: z.string(),
    sceneJson: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const { id, title, sceneJson } = parsed.data
  const now = new Date().toISOString()

  const existing = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [id])
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  if (sceneJson !== undefined) {
    await db.run('UPDATE diagrams SET title=?, scene_json=?, updated_at=? WHERE id=?', [
      title.trim() || 'Untitled diagram',
      sceneJson,
      now,
      id,
    ])
  } else {
    await db.run('UPDATE diagrams SET title=?, updated_at=? WHERE id=?', [
      title.trim() || 'Untitled diagram',
      now,
      id,
    ])
  }

  if (parsed.data.tags !== undefined) {
    await db.run(`DELETE FROM diagram_tags WHERE diagram_id=?`, [id])
    for (const tag of parsed.data.tags) {
      await db.run(`INSERT INTO diagram_tags (diagram_id, tag) VALUES (?, ?)`, [id, tag])
    }
  }

  return { data: { updatedAt: now } }
}

export async function archiveDiagram(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const archivedAt = new Date().toISOString()
  const existing = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [
    parsed.data.id,
  ])
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  await db.run('UPDATE diagrams SET archived_at=? WHERE id=?', [archivedAt, parsed.data.id])
  return { data: { archivedAt } }
}

export async function restoreDiagram(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const now = new Date().toISOString()
  const existing = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [
    parsed.data.id,
  ])
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  await db.run('UPDATE diagrams SET archived_at=NULL, updated_at=? WHERE id=?', [
    now,
    parsed.data.id,
  ])
  return { data: { ok: true } }
}

export async function hardDeleteDiagram(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const existing = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [
    parsed.data.id,
  ])
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  await db.run('DELETE FROM diagrams WHERE id=?', [parsed.data.id])
  return { data: { ok: true } }
}

export async function openDiagramInWindow(
  _db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }

  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (!mainWindow) return { error: 'NO_MAIN_WINDOW' }

  const baseUrl = mainWindow.webContents.getURL()
  const urlObj = new URL(baseUrl)
  urlObj.searchParams.set('view', 'notepad-diagram')
  urlObj.searchParams.set('diagramId', parsed.data.id)
  const diagramUrl = urlObj.toString()

  const preload = join(app.getAppPath(), 'out', 'preload', 'index.js')

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win
    .loadURL(diagramUrl)
    .catch((err) => console.error('[notepad] openDiagramInWindow: failed to load', err))

  return { data: { ok: true } }
}

export function registerDiagramsIpcHandlers(db: ExtensionDB): () => void {
  ipcMain.handle('terminator.notepad:diagrams.create', (_, payload) => createDiagram(db, payload))
  ipcMain.handle('terminator.notepad:diagrams.list', (_, payload) => listDiagrams(db, payload))
  ipcMain.handle('terminator.notepad:diagrams.get', (_, payload) => getDiagram(db, payload))
  ipcMain.handle('terminator.notepad:diagrams.autosave', (_, payload) =>
    autosaveDiagram(db, payload)
  )
  ipcMain.handle('terminator.notepad:diagrams.archive', (_, payload) => archiveDiagram(db, payload))
  ipcMain.handle('terminator.notepad:diagrams.restore', (_, payload) => restoreDiagram(db, payload))
  ipcMain.handle('terminator.notepad:diagrams.hardDelete', (_, payload) =>
    hardDeleteDiagram(db, payload)
  )
  ipcMain.handle('terminator.notepad:diagrams.openWindow', (_, payload) =>
    openDiagramInWindow(db, payload)
  )

  return () => {
    ipcMain.removeHandler('terminator.notepad:diagrams.create')
    ipcMain.removeHandler('terminator.notepad:diagrams.list')
    ipcMain.removeHandler('terminator.notepad:diagrams.get')
    ipcMain.removeHandler('terminator.notepad:diagrams.autosave')
    ipcMain.removeHandler('terminator.notepad:diagrams.archive')
    ipcMain.removeHandler('terminator.notepad:diagrams.restore')
    ipcMain.removeHandler('terminator.notepad:diagrams.hardDelete')
    ipcMain.removeHandler('terminator.notepad:diagrams.openWindow')
  }
}
