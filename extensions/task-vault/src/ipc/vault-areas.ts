import type { z } from 'zod'
import * as path from 'node:path'
import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { route, type IpcContext } from './register'
import { randomUUID } from '../vault/db'
import { toDisplayName } from '../vault/tags'
import { archiveAreaContents, restoreAreaContents } from '../vault/area-archive'
import { setProjectStatus } from '../vault/project-status'
import {
  ArchiveAreaRequestSchema,
  CreateAreaRequestSchema,
  DeleteAreaRequestSchema,
  RenameAreaRequestSchema,
  UpdateProjectStatusRequestSchema,
} from '../schemas/vault.schema'
import { indexUpdated, nowIso } from './vault-shared'

/** Posts an info notification for something just archived. */
function notifyArchived(api: ExtensionAPI, what: 'Area' | 'Project', name: string): void {
  api.notifications.createNotification({
    type: 'info',
    title: `${what} archived`,
    message: name,
    key: what === 'Area' ? 'areaArchived' : 'projectArchived',
  })
}

async function createArea({ db }: IpcContext, args: z.infer<typeof CreateAreaRequestSchema>) {
  const displayName = toDisplayName(args.name.trim())
  const now = nowIso()
  const existing = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [displayName])
  if (existing) return { error: 'AREA_EXISTS' }
  await db.run(`INSERT INTO areas (id,name,created_at,updated_at) VALUES (?,?,?,?)`, [
    randomUUID(),
    displayName,
    now,
    now,
  ])
  indexUpdated()
  return { success: true, filePath: displayName }
}

async function renameArea({ db }: IpcContext, args: z.infer<typeof RenameAreaRequestSchema>) {
  const { areaFilePath, newName } = args
  const now = nowIso()
  const area = await db.get<{ id: string; name: string }>(
    `SELECT id, name FROM areas WHERE name=?`,
    [areaFilePath]
  )
  if (!area) return { error: 'NOT_FOUND' }
  const existing = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=? AND id != ?`, [
    newName.trim(),
    area.id,
  ])
  if (existing) return { error: 'AREA_EXISTS' }
  await db.run(`UPDATE areas SET name=?, updated_at=? WHERE id=?`, [newName.trim(), now, area.id])
  indexUpdated()
  return { success: true }
}

async function archiveArea(
  { api, db }: IpcContext,
  args: z.infer<typeof ArchiveAreaRequestSchema>
) {
  const { areaName } = args
  const now = nowIso()
  const area = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [areaName])
  if (!area) return { error: 'NOT_FOUND' }
  await archiveAreaContents(db, area.id, now)
  await db.run(`UPDATE areas SET status='archived', updated_at=? WHERE id=?`, [now, area.id])
  notifyArchived(api, 'Area', areaName)
  indexUpdated()
  return { success: true }
}

async function deleteAreaContents(db: ExtensionDB, areaId: string): Promise<void> {
  const projectRows = await db.query<{ id: string }>(`SELECT id FROM projects WHERE area_id=?`, [
    areaId,
  ])
  for (const proj of projectRows) {
    await db.run(
      `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM tasks WHERE project_id=? AND parent_id IS NULL
           UNION ALL
           SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
         )
         DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)`,
      [proj.id]
    )
  }
  await db.run(`DELETE FROM tasks WHERE area_id=? AND project_id IS NULL`, [areaId])
  await db.run(`DELETE FROM projects WHERE area_id=?`, [areaId])
}

async function deleteArea({ db }: IpcContext, args: z.infer<typeof DeleteAreaRequestSchema>) {
  const areaName = path.basename(args.areaFilePath, '.md')
  const area = await db.get<{ id: string; status: string }>(
    `SELECT id, status FROM areas WHERE name=?`,
    [areaName]
  )
  if (!area) return { error: 'NOT_FOUND' }
  if (area.status !== 'archived') return { error: 'MUST_ARCHIVE_FIRST' }
  await deleteAreaContents(db, area.id)
  await db.run(`DELETE FROM areas WHERE id=?`, [area.id])
  indexUpdated()
  return { success: true }
}

async function restoreArea({ db }: IpcContext, args: z.infer<typeof ArchiveAreaRequestSchema>) {
  const now = nowIso()
  const area = await db.get<{ id: string; updated_at: string }>(
    `SELECT id, updated_at FROM areas WHERE name=?`,
    [args.areaName]
  )
  if (!area) return { error: 'NOT_FOUND' }
  await db.run(`UPDATE areas SET status='active', updated_at=? WHERE id=?`, [now, area.id])
  await restoreAreaContents(db, { id: area.id, archivedAt: area.updated_at }, now)
  indexUpdated()
  return { success: true }
}

async function updateProjectStatus(
  { api, db }: IpcContext,
  args: z.infer<typeof UpdateProjectStatusRequestSchema>
) {
  const { projectFilePath: projectName, status } = args
  if (!(await setProjectStatus(db, projectName, status))) return { error: 'NOT_FOUND' }
  if (status === 'archived') notifyArchived(api, 'Project', projectName)
  indexUpdated()
  return { success: true }
}

/** Channels that create, rename, archive, restore and delete areas, and archive projects. */
export const AREA_ROUTES = [
  route('task-vault:vault:create-area', CreateAreaRequestSchema, createArea),
  route('task-vault:vault:rename-area', RenameAreaRequestSchema, renameArea),
  route('task-vault:vault:archive-area', ArchiveAreaRequestSchema, archiveArea),
  route('task-vault:vault:delete-area', DeleteAreaRequestSchema, deleteArea),
  route('task-vault:vault:restore-area', ArchiveAreaRequestSchema, restoreArea),
  route(
    'task-vault:vault:update-project-status',
    UpdateProjectStatusRequestSchema,
    updateProjectStatus
  ),
]
