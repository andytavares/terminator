import type { z } from 'zod'
import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { registerRoutes, route, type IpcContext } from './register'
import { randomUUID } from '../vault/db'
import { toDisplayName } from '../vault/tags'
import {
  ListProjectsRequestSchema,
  UpdateProjectStatusRequestSchema,
  CreateProjectRequestSchema,
  DeleteProjectRequestSchema,
  UpdateProjectAreaRequestSchema,
  UpdateProjectDeadlineRequestSchema,
  RenameProjectRequestSchema,
} from '../schemas/vault.schema'
import type { ProjectStatus } from '../vault/types'
import { setProjectStatus } from '../vault/project-status'
import { rowToProject, PROJECT_COLS, PROJECT_JOINS } from '../vault/mappers'
import { findOrCreateArea, indexUpdated, nowIso } from './vault-shared'

type Row = Record<string, unknown>

/** A project with how many open next actions it has; none makes it stale. */
async function withNextActions(db: ExtensionDB, p: Row) {
  const ncRow = await db.get<{ c: string }>(
    `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status='open'`,
    [p.id as string]
  )
  const nextActionCount = Number(ncRow?.c ?? 0)
  return { ...rowToProject(p), nextActionCount, isStale: nextActionCount === 0 }
}

function statusFilterOf(status: unknown): ProjectStatus[] {
  if (!status) return ['active']
  if (Array.isArray(status)) return status as ProjectStatus[]
  return [status as ProjectStatus]
}

async function queryProjects({ db }: IpcContext, args: z.infer<typeof ListProjectsRequestSchema>) {
  const statusFilter = statusFilterOf(args.status)
  const placeholders = statusFilter.map(() => '?').join(',')
  const rows = await db.query<Row>(
    `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status IN (${placeholders}) ORDER BY p.name`,
    statusFilter
  )
  return { projects: await Promise.all(rows.map((p) => withNextActions(db, p))) }
}

async function insertProject({ db }: IpcContext, args: z.infer<typeof CreateProjectRequestSchema>) {
  const { name, area, deadline, outcome } = args
  const displayName = toDisplayName(name.trim())
  const existing = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [
    displayName,
  ])
  if (existing) return { error: 'PROJECT_EXISTS' }
  const now = nowIso()
  const areaId = area ? await findOrCreateArea(db, toDisplayName(area.trim()), now) : null
  await db.run(
    `INSERT INTO projects (id,name,status,area_id,deadline,outcome,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(), displayName, 'active', areaId, deadline ?? null, outcome ?? null, now, now]
  )
  indexUpdated()
  return { success: true, filePath: displayName }
}

async function deleteProjectRow(
  { db }: IpcContext,
  args: z.infer<typeof DeleteProjectRequestSchema>
) {
  const proj = await db.get<{ id: string; status: string }>(
    `SELECT id, status FROM projects WHERE name=?`,
    [args.projectFilePath]
  )
  if (!proj) return { error: 'NOT_FOUND' }
  if (proj.status !== 'archived') return { error: 'MUST_ARCHIVE_FIRST' }
  await db.run(
    `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM tasks WHERE project_id=? AND parent_id IS NULL
         UNION ALL
         SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
       )
       DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)`,
    [proj.id]
  )
  await db.run(`DELETE FROM tasks WHERE project_id=?`, [proj.id])
  await db.run(`DELETE FROM projects WHERE id=?`, [proj.id])
  indexUpdated()
  return { success: true }
}

async function updateProjectFileStatus(
  { db }: IpcContext,
  args: z.infer<typeof UpdateProjectStatusRequestSchema>
) {
  const { projectFilePath: projectName, status } = args
  if (!(await setProjectStatus(db, projectName, status))) return { error: 'NOT_FOUND' }
  indexUpdated()
  return { success: true }
}

async function updateArea(
  { db }: IpcContext,
  args: z.infer<typeof UpdateProjectAreaRequestSchema>
) {
  const { projectFilePath: projectName, area } = args
  const now = nowIso()
  const areaId = area ? await findOrCreateArea(db, area, now) : null
  await db.run(`UPDATE projects SET area_id=?, updated_at=? WHERE name=?`, [
    areaId,
    now,
    projectName,
  ])
  indexUpdated()
  return { success: true }
}

async function updateDeadline(
  { db }: IpcContext,
  args: z.infer<typeof UpdateProjectDeadlineRequestSchema>
) {
  const { projectFilePath: projectName, deadline } = args
  await db.run(`UPDATE projects SET deadline=?, updated_at=? WHERE name=?`, [
    deadline || null,
    nowIso(),
    projectName,
  ])
  indexUpdated()
  return { success: true }
}

async function renameProjectRow(
  { db }: IpcContext,
  args: z.infer<typeof RenameProjectRequestSchema>
) {
  const { projectFilePath: projectName, newName } = args
  const now = nowIso()
  const proj = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [projectName])
  if (!proj) return { error: 'NOT_FOUND' }
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM projects WHERE name=? AND id != ?`,
    [newName.trim(), proj.id]
  )
  if (existing) return { error: 'PROJECT_EXISTS' }
  await db.run(`UPDATE projects SET name=?, updated_at=? WHERE id=?`, [
    newName.trim(),
    now,
    proj.id,
  ])
  indexUpdated()
  return { success: true }
}

const PROJECT_ROUTES = [
  route('task-vault:projects:list', ListProjectsRequestSchema.default({}), queryProjects),
  route('task-vault:projects:create', CreateProjectRequestSchema, insertProject),
  route('task-vault:projects:delete', DeleteProjectRequestSchema, deleteProjectRow),
  route(
    'task-vault:projects:update-status',
    UpdateProjectStatusRequestSchema,
    updateProjectFileStatus
  ),
  route('task-vault:projects:update-area', UpdateProjectAreaRequestSchema, updateArea),
  route('task-vault:projects:update-deadline', UpdateProjectDeadlineRequestSchema, updateDeadline),
  route('task-vault:projects:rename', RenameProjectRequestSchema, renameProjectRow),
]

export function registerProjectsIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  return registerRoutes({ api, db }, PROJECT_ROUTES)
}
