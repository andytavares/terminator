import { ipcMain } from 'electron'
import { z } from 'zod'
import { randomUUID } from '../db/db'
import type { DiagramComment } from '../db/types'
import type { ExtensionDB } from '../../../../src/main/db/index'

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

export async function createDiagramComment(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({
    diagramId: z.string(),
    parentId: z.string().optional(),
    body: z.string().min(1),
    sceneX: z.number().optional(),
    sceneY: z.number().optional(),
  })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const diagramExists = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [
    parsed.data.diagramId,
  ])
  if (!diagramExists) return { error: 'DIAGRAM_NOT_FOUND' }

  const id = randomUUID()
  const now = new Date().toISOString()

  await db.run(
    `INSERT INTO diagram_comments (id, diagram_id, parent_id, body, scene_x, scene_y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      parsed.data.diagramId,
      parsed.data.parentId ?? null,
      parsed.data.body,
      parsed.data.sceneX ?? 0,
      parsed.data.sceneY ?? 0,
      now,
      now,
    ]
  )

  return { data: { id, createdAt: now } }
}

export async function listDiagramComments(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({
    diagramId: z.string(),
    includeResolved: z.boolean().optional(),
  })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const { diagramId, includeResolved = false } = parsed.data

  const statusFilter = includeResolved ? '' : `AND status = 'open'`
  const rows = await db.query<DbDiagramComment>(
    `SELECT id, diagram_id, parent_id, body, author, status, scene_x, scene_y, created_at, updated_at
     FROM diagram_comments
     WHERE diagram_id=? ${statusFilter}
     ORDER BY created_at ASC`,
    [diagramId]
  )

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

export async function resolveDiagramComment(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const now = new Date().toISOString()
  const existing = await db.get<{ id: string }>('SELECT id FROM diagram_comments WHERE id=?', [
    parsed.data.id,
  ])
  if (!existing) return { error: 'COMMENT_NOT_FOUND' }

  await db.run(
    `UPDATE diagram_comments SET status='resolved', updated_at=? WHERE id=? OR parent_id=?`,
    [now, parsed.data.id, parsed.data.id]
  )
  return { data: { ok: true } }
}

export async function deleteDiagramComment(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  await db.run('DELETE FROM diagram_comments WHERE id=?', [parsed.data.id])
  return { data: { ok: true } }
}

export function registerDiagramCommentsIpcHandlers(db: ExtensionDB): () => void {
  ipcMain.handle('terminator.notepad:diagram-comments.create', (_, payload) =>
    createDiagramComment(db, payload)
  )
  ipcMain.handle('terminator.notepad:diagram-comments.list', (_, payload) =>
    listDiagramComments(db, payload)
  )
  ipcMain.handle('terminator.notepad:diagram-comments.resolve', (_, payload) =>
    resolveDiagramComment(db, payload)
  )
  ipcMain.handle('terminator.notepad:diagram-comments.delete', (_, payload) =>
    deleteDiagramComment(db, payload)
  )

  return () => {
    ipcMain.removeHandler('terminator.notepad:diagram-comments.create')
    ipcMain.removeHandler('terminator.notepad:diagram-comments.list')
    ipcMain.removeHandler('terminator.notepad:diagram-comments.resolve')
    ipcMain.removeHandler('terminator.notepad:diagram-comments.delete')
  }
}
