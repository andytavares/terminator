import type { z } from 'zod'
import { noPayload, type ExtensionDB } from '@terminator/extension-sdk'
import { route, type IpcContext } from './register'
import { storedInstant, zonedNow } from '../vault/clock'
import {
  GetProjectTasksRequestSchema,
  ListArchiveRequestSchema,
  ListAreasRequestSchema,
  QueryRequestSchema,
} from '../schemas/vault.schema'
import {
  rowToTask,
  rowToProject,
  TASK_COLS,
  TASK_JOINS,
  PROJECT_COLS,
  PROJECT_JOINS,
} from '../vault/mappers'
import { orErrorString } from './vault-shared'

type Row = Record<string, unknown>

async function countRows(db: ExtensionDB, sql: string, params: unknown[]): Promise<number> {
  const row = await db.get<{ c: string }>(sql, params)
  return Number(row?.c ?? 0)
}

/** A project with its open, total and finished top-level task counts. */
async function projectWithCounts(db: ExtensionDB, p: Row) {
  const id = [p.id as string]
  const nextActionCount = await countRows(
    db,
    `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status='open'`,
    id
  )
  const totalTaskCount = await countRows(
    db,
    `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND parent_id IS NULL`,
    id
  )
  const doneTaskCount = await countRows(
    db,
    `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status IN ('done','cancelled','migrated') AND parent_id IS NULL`,
    id
  )
  return {
    ...rowToProject(p),
    nextActionCount,
    isStale: nextActionCount === 0,
    totalTaskCount,
    doneTaskCount,
  }
}

/** Open and total top-level tasks of an area, counting those of its projects too. */
async function areaTaskCounts(db: ExtensionDB, areaId: string) {
  const ids = [areaId, areaId]
  const openTaskCount = await countRows(
    db,
    `SELECT COUNT(DISTINCT t.id) as c FROM tasks t WHERE t.parent_id IS NULL AND t.status='open' AND (t.area_id=? OR t.project_id IN (SELECT id FROM projects WHERE area_id=?))`,
    ids
  )
  const taskCount = await countRows(
    db,
    `SELECT COUNT(DISTINCT t.id) as c FROM tasks t WHERE t.parent_id IS NULL AND (t.area_id=? OR t.project_id IN (SELECT id FROM projects WHERE area_id=?))`,
    ids
  )
  return { taskCount, openTaskCount }
}

async function areaSummary(db: ExtensionDB, a: Row) {
  const areaId = a.id as string
  const areaName = a.name as string
  const taskRows = await db.query<Row>(
    `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
           WHERE t.area_id=? AND t.parent_id IS NULL AND t.status NOT IN ('done','cancelled','migrated') ORDER BY t.created_at`,
    [areaId]
  )
  const projectRows = await db.query<Row>(
    `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.area_id=? ORDER BY p.name`,
    [areaId]
  )
  const projects = await Promise.all(projectRows.map((p) => projectWithCounts(db, p)))
  const { taskCount, openTaskCount } = await areaTaskCounts(db, areaId)
  return {
    filePath: areaName,
    name: areaName,
    status: (a.status as string) ?? 'active',
    taskCount,
    openTaskCount,
    tasks: taskRows.map(rowToTask),
    projects,
  }
}

function listAreas({ db }: IpcContext, args: z.infer<typeof ListAreasRequestSchema>) {
  return orErrorString(async () => {
    const statusFilter = args.status ?? 'active'
    const areaRows =
      statusFilter === 'all'
        ? await db.query<Row>(`SELECT * FROM areas ORDER BY name`)
        : await db.query<Row>(`SELECT * FROM areas WHERE status=? ORDER BY name`, [statusFilter])
    const areas: unknown[] = []
    for (const a of areaRows) areas.push(await areaSummary(db, a))
    return { areas }
  })
}

async function projectTasks(
  { db }: IpcContext,
  args: z.infer<typeof GetProjectTasksRequestSchema>
) {
  const { projectName } = args
  if (!projectName) return { tasks: [] }
  const rows = await db.query<Row>(
    `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE p.name=? ORDER BY t.status, t.created_at`,
    [projectName]
  )
  return { tasks: rows.map(rowToTask) }
}

function listArchive({ db }: IpcContext, args: z.infer<typeof ListArchiveRequestSchema>) {
  const days = args.days ?? 30
  return orErrorString(async () => {
    const cutoff = storedInstant(zonedNow().subtract({ days }).startOfDay())
    const taskRows = await db.query<Row>(
      `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
         WHERE t.status IN ('done','cancelled','migrated') AND t.updated_at >= ? ORDER BY t.updated_at DESC`,
      [cutoff]
    )
    const projectRows = await db.query<Row>(
      `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status='archived' ORDER BY p.updated_at DESC`
    )
    const areaRows = await db.query<Row>(
      `SELECT * FROM areas WHERE status='archived' ORDER BY updated_at DESC`
    )
    const areas = areaRows.map((a) => ({
      id: a.id as string,
      name: a.name as string,
      updatedAt: a.updated_at as string,
    }))
    return { tasks: taskRows.map(rowToTask), projects: projectRows.map(rowToProject), areas }
  })
}

type QueryArgs = z.infer<typeof QueryRequestSchema>

/** Equality filters a query may carry, with the column each one tests. */
const QUERY_FILTERS: [keyof QueryArgs, string][] = [
  ['context', 't.context=?'],
  ['project', 'p.name=?'],
  ['area', 'a.name=?'],
  ['dueBefore', 't.due_date < ?'],
]

function queryWhere(args: QueryArgs): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  if (args.status) {
    const statuses = Array.isArray(args.status) ? args.status : [args.status]
    conditions.push(`t.status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }
  for (const [key, condition] of QUERY_FILTERS) {
    if (!args[key]) continue
    conditions.push(condition)
    params.push(args[key])
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params }
}

async function queryTasks({ db }: IpcContext, args: QueryArgs) {
  const { where, params } = queryWhere(args)
  const rows = await db.query<Row>(
    `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} ${where} ORDER BY t.created_at`,
    params
  )
  return { tasks: rows.map(rowToTask) }
}

/** The contexts tasks carry, for the context filter. */
function listContexts({ db }: IpcContext) {
  return orErrorString(async () => {
    const rows = await db.query<{ context: string }>(
      `SELECT DISTINCT context FROM tasks
         WHERE context IS NOT NULL AND context != ''
         ORDER BY context`
    )
    return { contexts: rows.map((r) => r.context) }
  })
}

/** Read-only channels: the area overview, a project's tasks, the archive and task queries. */
export const QUERY_ROUTES = [
  route('task-vault:vault:query', QueryRequestSchema, queryTasks),
  route('task-vault:vault:list-contexts', noPayload, listContexts),
  route('task-vault:vault:list-areas', ListAreasRequestSchema, listAreas),
  route('task-vault:projects:get-tasks', GetProjectTasksRequestSchema, projectTasks),
  route('task-vault:vault:list-archive', ListArchiveRequestSchema.default({}), listArchive),
]
