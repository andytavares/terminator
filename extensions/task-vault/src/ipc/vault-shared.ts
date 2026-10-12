import type { ExtensionDB } from '@terminator/extension-sdk'
import { randomUUID } from '../vault/db'
import { toDisplayName } from '../vault/tags'
import { localDate } from '../vault/recurrence'
import { broadcast } from '../notifications/task-scheduler.js'
import { rowToTask, TASK_COLS, TASK_JOINS } from '../vault/mappers'
import type { IndexedTask } from '../vault/types'

type Row = Record<string, unknown>

/** Today's date in local time, as the daily log names it. */
export function today(): string {
  return localDate()
}

/** The current instant, as stored in created_at / updated_at. */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Tells every task-vault view that the index changed. */
export function indexUpdated(): void {
  broadcast('task-vault:push:index-updated', {})
}

/** Runs `run`, answering a thrown error as `{ error: String(err) }`. */
export async function orErrorString<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run()
  } catch (err) {
    return { error: String(err) }
  }
}

/** Maps rows to tasks and attaches each one's subtasks, in display order. */
export async function tasksWithSubtasks(db: ExtensionDB, rows: Row[]): Promise<IndexedTask[]> {
  const tasks = rows.map(rowToTask)
  for (const task of tasks) {
    const subtaskRows = await db.query<Row>(
      `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE t.parent_id=? ORDER BY t.sort_order, t.created_at`,
      [task.id]
    )
    task.subtasks = subtaskRows.map(rowToTask)
  }
  return tasks
}

/** The top-level tasks of one daily log, with their subtasks. */
export async function dailyTasks(db: ExtensionDB, date: string): Promise<IndexedTask[]> {
  const taskRows = await db.query<Row>(
    `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
         WHERE t.source='daily' AND t.source_ref=? AND t.parent_id IS NULL ORDER BY t.sort_order, t.created_at`,
    [date]
  )
  return tasksWithSubtasks(db, taskRows)
}

/** A task's metadata blob, or null when the task does not exist. */
export async function readTaskMeta<T = Record<string, unknown>>(
  db: ExtensionDB,
  taskId: string
): Promise<T | null> {
  const row = await db.get<{ metadata: string }>(`SELECT metadata FROM tasks WHERE id=?`, [taskId])
  if (!row) return null
  return JSON.parse(row.metadata || '{}') as T
}

/** Like readTaskMeta, but an unreadable blob counts as empty. */
export async function readTaskMetaLenient(
  db: ExtensionDB,
  taskId: string
): Promise<Record<string, unknown> | null> {
  const row = await db.get<{ metadata: string }>(`SELECT metadata FROM tasks WHERE id=?`, [taskId])
  if (!row) return null
  return parseMetaLenient(row.metadata)
}

/** Parses a metadata blob; an unreadable one counts as empty. */
export function parseMetaLenient(metadata: string): Record<string, unknown> {
  try {
    return JSON.parse(metadata || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Whether a task with this id exists. */
export async function taskExists(db: ExtensionDB, taskId: string): Promise<boolean> {
  const existing = await db.get<{ id: string }>(`SELECT id FROM tasks WHERE id=?`, [taskId])
  return Boolean(existing)
}

/** Deletes a task and every task below it. */
export async function deleteTaskTree(db: ExtensionDB, taskId: string): Promise<void> {
  await db.run(
    `WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
      )
      DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)`,
    [taskId]
  )
}

async function findOrCreateArea(db: ExtensionDB, name: string, now: string): Promise<string> {
  const existing = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [name])
  if (existing) return existing.id
  const id = randomUUID()
  await db.run(
    `INSERT INTO areas (id,name,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,
    [id, name, now, now]
  )
  return id
}

interface NewProjectRef {
  name: string
  areaId: string | null
  now: string
}

async function findOrCreateProject(db: ExtensionDB, project: NewProjectRef): Promise<string> {
  const existing = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [
    project.name,
  ])
  if (existing) return existing.id
  const id = randomUUID()
  await db.run(
    `INSERT INTO projects (id,name,status,area_id,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    [id, project.name, 'active', project.areaId, project.now, project.now]
  )
  return id
}

/** The @project and #area a task names, as extracted from its text. */
export interface TagRefs {
  project?: string
  area?: string
}

/** Resolves a task's @project and #area to ids, creating any that do not exist yet. */
export async function resolveProjectAndAreaIds(
  db: ExtensionDB,
  refs: TagRefs,
  now: string
): Promise<{ projectId: string | null; areaId: string | null }> {
  const areaId = refs.area ? await findOrCreateArea(db, toDisplayName(refs.area), now) : null
  const projectId = refs.project
    ? await findOrCreateProject(db, { name: toDisplayName(refs.project), areaId, now })
    : null
  return { projectId, areaId }
}

/** Where a vault-relative file path files a task: its source and source_ref. */
export function resolveSource(filePath: string): { source: string; sourceRef: string | null } {
  const normalized = filePath.replace(/\\/g, '/')
  const dailyMatch = /daily\/(\d{4}-\d{2}-\d{2})\.md$/.exec(normalized)
  if (dailyMatch) return { source: 'daily', sourceRef: dailyMatch[1] }
  const projectMatch = /projects\/(.+)\.md$/.exec(normalized)
  if (projectMatch) return { source: 'project', sourceRef: projectMatch[1] }
  const areaMatch = /areas\/(.+)\.md$/.exec(normalized)
  if (areaMatch) return { source: 'area', sourceRef: areaMatch[1] }
  if (normalized.endsWith('someday.md')) return { source: 'someday', sourceRef: null }
  return { source: 'inbox', sourceRef: null }
}
