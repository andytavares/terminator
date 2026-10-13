import { z } from 'zod'
import { randomUUID } from '../db/db'
import type { ExtensionDB, ExtensionAPI } from '@terminator/extension-sdk'
import { createIpcRegistrar, IdPayload } from './register'

const CreateDiagramPayload = z
  .object({
    title: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict()
  .default({})

export async function createDiagram(
  db: ExtensionDB,
  args: z.infer<typeof CreateDiagramPayload>
): Promise<Record<string, unknown>> {
  const id = randomUUID()
  const now = new Date().toISOString()
  const title = args.title?.trim() || 'Untitled diagram'

  await db.run(
    `INSERT INTO diagrams (id, title, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, title, '{}', now, now]
  )
  for (const tag of args.tags ?? []) {
    await db.run(`INSERT INTO diagram_tags (diagram_id, tag) VALUES (?, ?)`, [id, tag])
  }

  return { data: { id, title, createdAt: now } }
}

const ListDiagramsPayload = z.object({ includeArchived: z.boolean().optional() }).default({})

type DiagramListRow = {
  id: string
  title: string
  created_at: string
  updated_at: string
  archived_at: string | null
  sort_order: number
  folder_id: string | null
}

type DiagramRow = {
  id: string
  title: string
  scene_json: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

export async function listDiagrams(
  db: ExtensionDB,
  args: z.infer<typeof ListDiagramsPayload>
): Promise<Record<string, unknown>> {
  const { includeArchived = false } = args

  const archivedFilter = includeArchived ? '' : 'AND archived_at IS NULL'
  const rows = await db.query<DiagramListRow>(
    `SELECT id, title, created_at, updated_at, archived_at, COALESCE(sort_order, 0) AS sort_order, folder_id
     FROM diagrams
     WHERE 1=1 ${archivedFilter}
     ORDER BY COALESCE(sort_order, 0) ASC, updated_at DESC`
  )
  const tagsByDiagramId = await diagramTagsById(db)
  return { data: rows.map((r) => toDiagramListItem(r, tagsByDiagramId.get(r.id) ?? [])) }
}

async function diagramTagsById(db: ExtensionDB): Promise<Map<string, string[]>> {
  const allTagRows = await db.query<{ diagram_id: string; tag: string }>(
    `SELECT diagram_id, tag FROM diagram_tags ORDER BY tag`
  )
  const tagsByDiagramId = new Map<string, string[]>()
  for (const t of allTagRows) {
    const arr = tagsByDiagramId.get(t.diagram_id) ?? []
    arr.push(t.tag)
    tagsByDiagramId.set(t.diagram_id, arr)
  }
  return tagsByDiagramId
}

function toDiagramListItem(r: DiagramListRow, tags: string[]) {
  return {
    id: r.id,
    title: r.title,
    tags,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
    type: 'diagram' as const,
    sortOrder: r.sort_order ?? 0,
    folderId: r.folder_id ?? null,
  }
}

export async function getDiagram(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const row = await db.get<DiagramRow>(
    `SELECT id, title, scene_json, created_at, updated_at, archived_at FROM diagrams WHERE id=?`,
    [args.id]
  )
  if (!row) return { error: 'DIAGRAM_NOT_FOUND' }

  const tagRows = await db.query<{ tag: string }>(
    `SELECT tag FROM diagram_tags WHERE diagram_id=? ORDER BY tag`,
    [args.id]
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

const AutosaveDiagramPayload = z.object({
  id: z.string(),
  title: z.string(),
  sceneJson: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export async function autosaveDiagram(
  db: ExtensionDB,
  args: z.infer<typeof AutosaveDiagramPayload>
): Promise<Record<string, unknown>> {
  const { id } = args
  const now = new Date().toISOString()

  const existing = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [id])
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  await saveDiagramContent(db, args, now)
  if (args.tags !== undefined) await replaceDiagramTags(db, id, args.tags)

  return { data: { updatedAt: now } }
}

/** The title, and the scene when one was sent; a title-only save keeps the scene. */
async function saveDiagramContent(
  db: ExtensionDB,
  args: z.infer<typeof AutosaveDiagramPayload>,
  now: string
): Promise<void> {
  const { id, sceneJson } = args
  const title = args.title.trim() || 'Untitled diagram'
  if (sceneJson !== undefined) {
    await db.run('UPDATE diagrams SET title=?, scene_json=?, updated_at=? WHERE id=?', [
      title,
      sceneJson,
      now,
      id,
    ])
  } else {
    await db.run('UPDATE diagrams SET title=?, updated_at=? WHERE id=?', [title, now, id])
  }
}

async function replaceDiagramTags(db: ExtensionDB, id: string, tags: string[]): Promise<void> {
  await db.run(`DELETE FROM diagram_tags WHERE diagram_id=?`, [id])
  for (const tag of tags) {
    await db.run(`INSERT INTO diagram_tags (diagram_id, tag) VALUES (?, ?)`, [id, tag])
  }
}

export async function archiveDiagram(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const archivedAt = new Date().toISOString()
  const existing = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [args.id])
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  await db.run('UPDATE diagrams SET archived_at=? WHERE id=?', [archivedAt, args.id])
  return { data: { archivedAt } }
}

export async function restoreDiagram(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString()
  const existing = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [args.id])
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  await db.run('UPDATE diagrams SET archived_at=NULL, updated_at=? WHERE id=?', [now, args.id])
  return { data: { ok: true } }
}

export async function hardDeleteDiagram(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const existing = await db.get<{ id: string }>('SELECT id FROM diagrams WHERE id=?', [args.id])
  if (!existing) return { error: 'DIAGRAM_NOT_FOUND' }

  await db.run('DELETE FROM diagrams WHERE id=?', [args.id])
  return { data: { ok: true } }
}

export function registerDiagramsIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handleRemote, cleanup } = createIpcRegistrar(api)
  handleRemote('terminator.notepad:diagrams.create', CreateDiagramPayload, (args) =>
    createDiagram(db, args)
  )
  handleRemote('terminator.notepad:diagrams.list', ListDiagramsPayload, (args) =>
    listDiagrams(db, args)
  )
  handleRemote('terminator.notepad:diagrams.get', IdPayload, (args) => getDiagram(db, args))
  handleRemote('terminator.notepad:diagrams.autosave', AutosaveDiagramPayload, (args) =>
    autosaveDiagram(db, args)
  )
  handleRemote('terminator.notepad:diagrams.archive', IdPayload, (args) => archiveDiagram(db, args))
  handleRemote('terminator.notepad:diagrams.restore', IdPayload, (args) => restoreDiagram(db, args))
  handleRemote('terminator.notepad:diagrams.hardDelete', IdPayload, (args) =>
    hardDeleteDiagram(db, args)
  )
  return cleanup
}
