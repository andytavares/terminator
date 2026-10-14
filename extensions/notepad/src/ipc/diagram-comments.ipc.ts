import { z } from 'zod'
import { randomUUID } from '../db/db'
import type { DiagramComment } from '../db/types'
import type { ExtensionDB, ExtensionAPI } from '@terminator/extension-sdk'
import { notepadChannels, IdPayload } from './register'

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

const CreateDiagramCommentPayload = z.object({
  diagramId: z.string(),
  parentId: z.string().optional(),
  body: z.string().min(1),
  sceneX: z.number().optional(),
  sceneY: z.number().optional(),
})

/** @internal */
export async function createDiagramComment(
  db: ExtensionDB,
  args: z.infer<typeof CreateDiagramCommentPayload>
): Promise<Record<string, unknown>> {
  const diagramExists = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [
    args.diagramId,
  ])
  if (!diagramExists) return { error: 'DIAGRAM_NOT_FOUND' }

  const id = randomUUID()
  const now = new Date().toISOString()

  await db.run(
    `INSERT INTO diagram_comments (id, diagram_id, parent_id, body, scene_x, scene_y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      args.diagramId,
      args.parentId ?? null,
      args.body,
      args.sceneX ?? 0,
      args.sceneY ?? 0,
      now,
      now,
    ]
  )

  return { data: { id, createdAt: now } }
}

const ListDiagramCommentsPayload = z.object({
  diagramId: z.string(),
  includeResolved: z.boolean().optional(),
})

/** @internal */
export async function listDiagramComments(
  db: ExtensionDB,
  args: z.infer<typeof ListDiagramCommentsPayload>
): Promise<Record<string, unknown>> {
  const { diagramId, includeResolved = false } = args

  const statusFilter = includeResolved ? '' : `AND status = 'open'`
  const rows = await db.query<DbDiagramComment>(
    `SELECT id, diagram_id, parent_id, body, author, status, scene_x, scene_y, created_at, updated_at
     FROM diagram_comments
     WHERE diagram_id=? ${statusFilter}
     ORDER BY created_at ASC`,
    [diagramId]
  )

  const roots = rows.filter((r) => r.parent_id === null)
  const childMap = repliesByParent(rows)
  const data = roots.map((r) =>
    mapComment(
      r,
      (childMap.get(r.id) ?? []).map((c) => mapComment(c))
    )
  )
  return { data }
}

function repliesByParent(rows: DbDiagramComment[]): Map<string, DbDiagramComment[]> {
  const childMap = new Map<string, DbDiagramComment[]>()
  for (const r of rows) {
    if (r.parent_id) {
      const list = childMap.get(r.parent_id) ?? []
      list.push(r)
      childMap.set(r.parent_id, list)
    }
  }
  return childMap
}

/** @internal */
export async function resolveDiagramComment(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString()
  const existing = await db.get<{ id: string }>('SELECT id FROM diagram_comments WHERE id=?', [
    args.id,
  ])
  if (!existing) return { error: 'COMMENT_NOT_FOUND' }

  await db.run(
    `UPDATE diagram_comments SET status='resolved', updated_at=? WHERE id=? OR parent_id=?`,
    [now, args.id, args.id]
  )
  return { data: { ok: true } }
}

/** @internal */
export async function deleteDiagramComment(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  await db.run('DELETE FROM diagram_comments WHERE id=?', [args.id])
  return { data: { ok: true } }
}

export function registerDiagramCommentsIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handleRemote, cleanup } = notepadChannels(api)
  handleRemote('terminator.notepad:diagram-comments.create', CreateDiagramCommentPayload, (args) =>
    createDiagramComment(db, args)
  )
  handleRemote('terminator.notepad:diagram-comments.list', ListDiagramCommentsPayload, (args) =>
    listDiagramComments(db, args)
  )
  handleRemote('terminator.notepad:diagram-comments.resolve', IdPayload, (args) =>
    resolveDiagramComment(db, args)
  )
  handleRemote('terminator.notepad:diagram-comments.delete', IdPayload, (args) =>
    deleteDiagramComment(db, args)
  )

  return cleanup
}
