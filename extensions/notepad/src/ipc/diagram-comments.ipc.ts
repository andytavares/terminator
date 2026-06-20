import { ipcMain } from 'electron'
import { z } from 'zod'
import { getDb, randomUUID } from '../db/db'
import type { DiagramComment } from '../db/types'

const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

type DbDiagramComment = {
  id: string
  diagram_id: string
  parent_id: string | null
  body: string
  author: string
  status: string
  scene_x: number
  scene_y: number
  created_at: string
  updated_at: string
}

function mapComment(r: DbDiagramComment, replies: DiagramComment[] = []): DiagramComment {
  return {
    id: r.id,
    diagramId: r.diagram_id,
    parentId: r.parent_id,
    body: r.body,
    author: r.author,
    status: r.status as 'open' | 'resolved',
    sceneX: r.scene_x,
    sceneY: r.scene_y,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    replies,
  }
}

export async function createDiagramComment(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({
    diagramId: z.string(),
    parentId: z.string().optional(),
    body: z.string().min(1),
    sceneX: z.number().optional(),
    sceneY: z.number().optional(),
  })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const diagramExists = db.prepare('SELECT id FROM diagrams WHERE id=?').get(parsed.data.diagramId)
  if (!diagramExists) return { error: 'DIAGRAM_NOT_FOUND' }

  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO diagram_comments (id, diagram_id, parent_id, body, scene_x, scene_y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    parsed.data.diagramId,
    parsed.data.parentId ?? null,
    parsed.data.body,
    parsed.data.sceneX ?? 0,
    parsed.data.sceneY ?? 0,
    now,
    now
  )

  return { data: { id, createdAt: now } }
}

export async function listDiagramComments(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({
    diagramId: z.string(),
    includeResolved: z.boolean().optional(),
  })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const { diagramId, includeResolved = false } = parsed.data
  const db = getDb()

  const statusFilter = includeResolved ? '' : `AND status = 'open'`
  const rows = db
    .prepare(
      `SELECT id, diagram_id, parent_id, body, author, status, scene_x, scene_y, created_at, updated_at
       FROM diagram_comments
       WHERE diagram_id=? ${statusFilter}
       ORDER BY created_at ASC`
    )
    .all(diagramId) as DbDiagramComment[]

  const roots = rows.filter((r) => r.parent_id === null)
  const childMap = new Map<string, DbDiagramComment[]>()
  for (const r of rows) {
    if (r.parent_id) {
      const list = childMap.get(r.parent_id) ?? []
      list.push(r)
      childMap.set(r.parent_id, list)
    }
  }

  const data = roots.map((r) =>
    mapComment(
      r,
      (childMap.get(r.id) ?? []).map((c) => mapComment(c))
    )
  )
  return { data }
}

export async function resolveDiagramComment(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  const now = new Date().toISOString()
  const existing = db.prepare('SELECT id FROM diagram_comments WHERE id=?').get(parsed.data.id)
  if (!existing) return { error: 'COMMENT_NOT_FOUND' }

  db.prepare(
    `UPDATE diagram_comments SET status='resolved', updated_at=? WHERE id=? OR parent_id=?`
  ).run(now, parsed.data.id, parsed.data.id)
  return { data: { ok: true } }
}

export async function deleteDiagramComment(payload: unknown): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const db = getDb()
  db.prepare('DELETE FROM diagram_comments WHERE id=?').run(parsed.data.id)
  return { data: { ok: true } }
}

export function registerDiagramCommentsIpcHandlers(): () => void {
  ipcMain.handle('terminator.notepad:diagram-comments.create', (_, payload) =>
    createDiagramComment(payload)
  )
  ipcMain.handle('terminator.notepad:diagram-comments.list', (_, payload) =>
    listDiagramComments(payload)
  )
  ipcMain.handle('terminator.notepad:diagram-comments.resolve', (_, payload) =>
    resolveDiagramComment(payload)
  )
  ipcMain.handle('terminator.notepad:diagram-comments.delete', (_, payload) =>
    deleteDiagramComment(payload)
  )

  return () => {
    ipcMain.removeHandler('terminator.notepad:diagram-comments.create')
    ipcMain.removeHandler('terminator.notepad:diagram-comments.list')
    ipcMain.removeHandler('terminator.notepad:diagram-comments.resolve')
    ipcMain.removeHandler('terminator.notepad:diagram-comments.delete')
  }
}
