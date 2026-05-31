import * as path from 'node:path'
import { ipcMain } from 'electron'
import { getDb, randomUUID } from '../vault/db'
import { extractTags, toDisplayName } from '../vault/tags'
import { localDate as _localDate } from '../vault/recurrence'
import { ensureNextOccurrence } from '../vault/ensure-next-occurrence'
import {
  CaptureRequestSchema,
  GetDailyRequestSchema,
  AddTaskRequestSchema,
  CompleteTaskRequestSchema,
  MigrateTaskRequestSchema,
  QueryRequestSchema,
  ProcessInboxRequestSchema,
  UpdateProjectStatusRequestSchema,
  EditTaskRequestSchema,
  DeleteTaskRequestSchema,
  CancelTaskRequestSchema,
  RestoreTaskRequestSchema,
  CreateAreaRequestSchema,
  DeleteAreaRequestSchema,
  ListArchiveRequestSchema,
  GetTaskDetailRequestSchema,
  SaveTaskDetailRequestSchema,
  BlockTaskRequestSchema,
  UnblockTaskRequestSchema,
  ReorderTasksRequestSchema,
  SetRecurrenceRequestSchema,
  ClearRecurrenceRequestSchema,
  ArchiveAreaRequestSchema,
} from '../schemas/vault.schema'
import type { IndexedTask, IndexedProject, TaskStatus, ProjectStatus } from '../vault/types'
import { triggerSchedulerTick, broadcast } from '../notifications/task-scheduler.js'

// vaultPath is kept so ICS handler can still use it (unchanged)
let vaultPath = ''

export function setVaultPath(p: string) {
  vaultPath = p
}

// Suppress unused warning — vaultPath is a public export contract
export function getVaultPath(): string {
  return vaultPath
}

const localDate = _localDate

function today(): string {
  return localDate()
}

function rowToTask(row: Record<string, unknown>): IndexedTask {
  const source = row.source as string
  const sourceRef = row.source_ref as string | null
  const filePath = sourceRef ? `${source}/${sourceRef}` : source
  let blockedReason: string | undefined
  let blockedCheckInterval: string | undefined
  let recurrenceEndType: 'none' | 'on_date' | 'after_count' | undefined
  let recurrenceEndDate: string | undefined
  let recurrenceEndCount: number | undefined
  let recurrenceCompletedCount: number | undefined
  try {
    const meta = JSON.parse((row.metadata as string) || '{}') as Record<string, unknown>
    blockedReason = (meta.blocked_reason as string) || undefined
    blockedCheckInterval = (meta.blocked_check_interval as string) || undefined
    recurrenceEndType =
      (meta.recurrence_end_type as 'none' | 'on_date' | 'after_count') || undefined
    recurrenceEndDate = (meta.recurrence_end_date as string) || undefined
    recurrenceEndCount =
      meta.recurrence_end_count != null ? (meta.recurrence_end_count as number) : undefined
    recurrenceCompletedCount =
      meta.recurrence_completed_count != null
        ? (meta.recurrence_completed_count as number)
        : undefined
  } catch {
    // ignore malformed metadata
  }

  // Parse recurrence fields from first-class columns
  const recurrenceRule = (row.recurrence_rule as string) || undefined
  const recurrenceTemplateId = (row.recurrence_template_id as string) || undefined
  const recurrenceNotifyAt = (row.recurrence_notify_at as string) || undefined

  return {
    id: row.id as string,
    filePath,
    line: 0,
    status: row.status as TaskStatus,
    text: row.text as string,
    project: (row.project as string) || undefined,
    context: (row.context as string) || undefined,
    area: (row.area as string) || undefined,
    dueDate: (row.due_date as string) || undefined,
    terminatorLinks: JSON.parse((row.terminator_links as string) || '[]'),
    subtasks: [],
    blockedReason,
    blockedCheckInterval,
    recurrenceRule,
    recurrenceTemplateId,
    recurrenceNotifyAt,
    recurrenceEndType,
    recurrenceEndDate,
    recurrenceEndCount,
    recurrenceCompletedCount,
  }
}

function rowToProject(row: Record<string, unknown>): IndexedProject {
  return {
    id: row.id as string,
    filePath: row.name as string, // use name as stable identifier
    name: row.name as string,
    status: row.status as ProjectStatus,
    area: (row.area as string) || undefined,
    deadline: (row.deadline as string) || undefined,
    isStale: false, // filled by caller
    nextActionCount: 0, // filled by caller
    lastModified: row.updated_at as string,
    terminatorLinks: JSON.parse((row.terminator_links as string) || '[]'),
  }
}

/** Derive source + source_ref from the filePath the renderer passes for add-task */
function resolveSource(filePath: string): { source: string; sourceRef: string | null } {
  const normalized = filePath.replace(/\\/g, '/')
  // daily/YYYY-MM-DD.md
  const dailyMatch = /daily\/(\d{4}-\d{2}-\d{2})\.md$/.exec(normalized)
  if (dailyMatch) return { source: 'daily', sourceRef: dailyMatch[1] }
  // projects/<name>.md
  const projectMatch = /projects\/(.+)\.md$/.exec(normalized)
  if (projectMatch) return { source: 'project', sourceRef: projectMatch[1] }
  // areas/<name>.md
  const areaMatch = /areas\/(.+)\.md$/.exec(normalized)
  if (areaMatch) return { source: 'area', sourceRef: areaMatch[1] }
  // someday.md
  if (normalized.endsWith('someday.md')) return { source: 'someday', sourceRef: null }
  return { source: 'inbox', sourceRef: null }
}

const TASK_COLS = `
  t.id, t.text, t.status, p.name AS project, t.context, a.name AS area,
  t.due_date, t.completed_date, t.migrated_to,
  t.terminator_links, t.source, t.source_ref, t.parent_id,
  t.sort_order, t.metadata, t.created_at, t.updated_at,
  t.project_id, t.area_id,
  t.recurrence_rule, t.recurrence_template_id, t.recurrence_notify_at
`
const TASK_JOINS = `LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN areas a ON t.area_id = a.id`

function resolveProjectAndAreaIds(
  db: ReturnType<typeof getDb>,
  project: string | undefined,
  area: string | undefined,
  now: string
): { projectId: string | null; areaId: string | null } {
  const areaName = area ? toDisplayName(area) : undefined
  const projectName = project ? toDisplayName(project) : undefined

  let areaId: string | null = null
  if (areaName) {
    const existingArea = db.prepare(`SELECT id FROM areas WHERE name=?`).get(areaName) as
      | { id: string }
      | undefined
    if (existingArea) {
      areaId = existingArea.id
    } else {
      areaId = randomUUID()
      db.prepare(`INSERT OR IGNORE INTO areas (id,name,created_at) VALUES (?,?,?)`).run(
        areaId,
        areaName,
        now
      )
    }
  }

  let projectId: string | null = null
  if (projectName) {
    const existingProject = db.prepare(`SELECT id FROM projects WHERE name=?`).get(projectName) as
      | { id: string }
      | undefined
    if (existingProject) {
      projectId = existingProject.id
    } else {
      projectId = randomUUID()
      db.prepare(
        `INSERT OR IGNORE INTO projects (id,name,status,area_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`
      ).run(projectId, projectName, 'active', areaId, now, now)
    }
  }

  return { projectId, areaId }
}

export function registerVaultIpcHandlers(): () => void {
  const handlers: Array<[string, (...args: unknown[]) => unknown]> = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, fn)
    handlers.push([channel, fn as (...args: unknown[]) => unknown])
  }

  // ── vault:capture ────────────────────────────────────────────────────────────

  handle('task-vault:vault:capture', async (_event, payload) => {
    const parsed = CaptureRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR: ' + parsed.error.message }
    const { text, hintArea, hintProject } = parsed.data

    const tags: string[] = []
    if (hintProject) tags.push(`@${hintProject}`)
    if (hintArea) tags.push(`#${hintArea}`)
    const fullText = tags.length ? `${text} ${tags.join(' ')}` : text
    const extracted = extractTags(fullText)

    const db = getDb()
    const now = new Date().toISOString()
    const id = randomUUID()
    const { projectId, areaId } = resolveProjectAndAreaIds(
      db,
      extracted.project,
      extracted.area,
      now
    )
    db.prepare(
      `INSERT INTO tasks (id,text,status,project_id,context,area_id,due_date,source,source_ref,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      extracted.text,
      'open',
      projectId,
      extracted.context ?? null,
      areaId,
      extracted.dueDate ?? null,
      'inbox',
      null,
      now,
      now
    )
    return { taskId: id }
  })

  // ── vault:get-today ──────────────────────────────────────────────────────────

  handle('task-vault:vault:get-today', async () => {
    try {
      const date = today()
      const db = getDb()
      const now = new Date().toISOString()

      // Rollover: move open/in-progress tasks from past daily logs to today
      const staleRows = db
        .prepare(
          `SELECT t.id, t.text, p.name AS project, t.context, a.name AS area, t.due_date, t.project_id, t.area_id
           FROM tasks t ${TASK_JOINS}
           WHERE t.source='daily' AND t.source_ref < ? AND t.source_ref IS NOT NULL
             AND t.status IN ('open','in-progress','blocked') AND t.parent_id IS NULL
             AND t.recurrence_rule IS NULL`
        )
        .all(date) as Record<string, unknown>[]

      const rolledOverIds: string[] = []
      if (staleRows.length > 0) {
        const insertStmt = db.prepare(
          `INSERT OR IGNORE INTO tasks (id,text,status,project_id,context,area_id,due_date,source,source_ref,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        const migrateStmt = db.prepare(
          `UPDATE tasks SET status='migrated', migrated_to=?, updated_at=? WHERE id=?`
        )
        const migrateSubStmt = db.prepare(
          `UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`
        )
        for (const row of staleRows) {
          const newId = randomUUID()
          insertStmt.run(
            newId,
            row.text,
            'open',
            row.project_id ?? null,
            row.context ?? null,
            row.area_id ?? null,
            row.due_date ?? null,
            'daily',
            date,
            now,
            now
          )
          migrateStmt.run(date, now, row.id)
          migrateSubStmt.run(date, now, row.id)
          rolledOverIds.push(newId)
        }
      }

      const taskRows = db
        .prepare(
          `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
           WHERE t.source='daily' AND t.source_ref=? AND t.parent_id IS NULL ORDER BY t.sort_order, t.created_at`
        )
        .all(date) as Record<string, unknown>[]
      const tasks = taskRows.map(rowToTask)
      for (const task of tasks) {
        task.subtasks = (
          db
            .prepare(
              `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE t.parent_id=? ORDER BY t.sort_order, t.created_at`
            )
            .all(task.id) as Record<string, unknown>[]
        ).map(rowToTask)
      }
      return {
        date,
        filePath: `daily/${date}.md`,
        tasks,
        rolledOver: staleRows.length,
        rolledOverIds,
        exists: tasks.length > 0,
      }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:get-daily ──────────────────────────────────────────────────────────

  handle('task-vault:vault:get-daily', async (_event, payload) => {
    const parsed = GetDailyRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const { date } = parsed.data
      const db = getDb()
      const taskRows = db
        .prepare(
          `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
           WHERE t.source='daily' AND t.source_ref=? AND t.parent_id IS NULL ORDER BY t.sort_order, t.created_at`
        )
        .all(date) as Record<string, unknown>[]
      const tasks = taskRows.map(rowToTask)
      for (const task of tasks) {
        task.subtasks = (
          db
            .prepare(
              `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE t.parent_id=? ORDER BY t.sort_order, t.created_at`
            )
            .all(task.id) as Record<string, unknown>[]
        ).map(rowToTask)
      }
      return {
        date,
        filePath: `daily/${date}.md`,
        tasks,
        exists: tasks.length > 0,
      }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:add-task ───────────────────────────────────────────────────────────

  handle('task-vault:vault:add-task', async (_event, payload) => {
    const parsed = AddTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { filePath, text, dueDate, tags } = parsed.data

    const parts: string[] = [text]
    if (tags?.project) parts.push(`@${tags.project}`)
    if (tags?.context) parts.push(`+${tags.context}`)
    if (tags?.area) parts.push(`#${tags.area}`)
    if (dueDate) parts.push(`due:${dueDate}`)
    const fullText = parts.join(' ')
    const extracted = extractTags(fullText)

    const { source, sourceRef } = resolveSource(filePath)
    const db = getDb()
    const now = new Date().toISOString()
    const id = randomUUID()
    const { projectId, areaId } = resolveProjectAndAreaIds(
      db,
      extracted.project,
      extracted.area,
      now
    )
    db.prepare(
      `INSERT INTO tasks (id,text,status,project_id,context,area_id,due_date,source,source_ref,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      extracted.text,
      'open',
      projectId,
      extracted.context ?? null,
      areaId,
      extracted.dueDate ?? null,
      source,
      sourceRef,
      now,
      now
    )
    return { taskId: id }
  })

  // ── vault:complete-task ──────────────────────────────────────────────────────

  handle('task-vault:vault:complete-task', async (_event, payload) => {
    const parsed = CompleteTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    const todayStr = today()

    try {
      let nextTaskId: string | null = null
      const completeAndSpawn = db.transaction(() => {
        const changes = db
          .prepare(`UPDATE tasks SET status='done', completed_date=?, updated_at=? WHERE id=?`)
          .run(todayStr, now, taskId)
        if (changes.changes === 0) throw new Error('STALE_ID')
        nextTaskId = ensureNextOccurrence(db, taskId)
      })
      completeAndSpawn()

      if (nextTaskId) {
        const nextDue = (
          db.prepare(`SELECT due_date FROM tasks WHERE id=?`).get(nextTaskId) as
            | { due_date: string }
            | undefined
        )?.due_date
        broadcast('task-vault:recurrence-spawned', { taskId, nextTaskId, nextDue })
      }

      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'STALE_ID') return { error: 'STALE_ID' }
      return { error: msg }
    }
  })

  // ── vault:migrate-task ───────────────────────────────────────────────────────

  handle('task-vault:vault:migrate-task', async (_event, payload) => {
    const parsed = MigrateTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, targetDate } = parsed.data
    const db = getDb()
    const task = db
      .prepare(`SELECT t.*, t.project_id, t.area_id FROM tasks t WHERE t.id=?`)
      .get(taskId) as Record<string, unknown> | undefined
    if (!task) return { error: 'STALE_ID' }
    const now = new Date().toISOString()
    const newId = randomUUID()
    const existingMeta = JSON.parse((task.metadata as string) || '{}') as Record<string, unknown>
    existingMeta.migration_twin_id = newId
    db.prepare(
      `UPDATE tasks SET status='migrated', migrated_to=?, metadata=?, updated_at=? WHERE id=?`
    ).run(targetDate, JSON.stringify(existingMeta), now, taskId)
    // Create new parent task on target date
    db.prepare(
      `INSERT INTO tasks (id,text,status,project_id,context,area_id,due_date,source,source_ref,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId,
      task.text,
      'open',
      task.project_id ?? null,
      task.context ?? null,
      task.area_id ?? null,
      task.due_date ?? null,
      'daily',
      targetDate,
      now,
      now
    )
    // Migrate subtasks: create twins under the new parent, mark originals as migrated
    type SubRow = { id: string; text: string; sort_order: number | null; metadata: string }
    const subtasks = db
      .prepare(
        `SELECT id, text, sort_order, metadata FROM tasks WHERE parent_id=? ORDER BY sort_order, created_at`
      )
      .all(taskId) as SubRow[]
    for (const sub of subtasks) {
      const subTwinId = randomUUID()
      const subMeta = JSON.parse(sub.metadata || '{}') as Record<string, unknown>
      subMeta.migration_twin_id = subTwinId
      db.prepare(
        `UPDATE tasks SET status='migrated', migrated_to=?, metadata=?, updated_at=? WHERE id=?`
      ).run(targetDate, JSON.stringify(subMeta), now, sub.id)
      db.prepare(
        `INSERT INTO tasks (id,text,status,parent_id,sort_order,source,source_ref,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        subTwinId,
        sub.text,
        'open',
        newId,
        sub.sort_order ?? null,
        'daily',
        targetDate,
        now,
        now
      )
    }
    return { newTaskId: newId }
  })

  // ── vault:query ──────────────────────────────────────────────────────────────

  handle('task-vault:vault:query', async (_event, payload) => {
    const parsed = QueryRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { status, context, project, area, dueBefore } = parsed.data

    const db = getDb()
    const conditions: string[] = []
    const params: unknown[] = []

    if (status) {
      const statuses = Array.isArray(status) ? status : [status]
      conditions.push(`t.status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    }
    if (context) {
      conditions.push(`t.context=?`)
      params.push(context)
    }
    if (project) {
      conditions.push(`p.name=?`)
      params.push(project)
    }
    if (area) {
      conditions.push(`a.name=?`)
      params.push(area)
    }
    if (dueBefore) {
      conditions.push(`t.due_date < ?`)
      params.push(dueBefore)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db
      .prepare(`SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} ${where} ORDER BY t.created_at`)
      .all(...params) as Record<string, unknown>[]
    return { tasks: rows.map(rowToTask) }
  })

  // ── vault:process-inbox-item ─────────────────────────────────────────────────

  handle('task-vault:vault:process-inbox-item', async (_event, payload) => {
    const parsed = ProcessInboxRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, action, destination, newProjectName } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()

    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(taskId) as
      | Record<string, unknown>
      | undefined
    if (!task) return { error: 'STALE_ID' }

    if (action === 'trash') {
      db.prepare(
        `
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM tasks WHERE id = ?
          UNION ALL
          SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
        )
        DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)
      `
      ).run(taskId)
      return { success: true }
    }

    if (action === 'do-now') {
      // Move to today's daily log so the task stays visible
      const todayDate = today()
      db.prepare(
        `UPDATE tasks SET status='in-progress', source='daily', source_ref=?, updated_at=? WHERE id=?`
      ).run(todayDate, now, taskId)
      db.prepare(
        `UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`
      ).run(todayDate, now, taskId)
      return { success: true }
    }

    if (action === 'someday') {
      db.prepare(`UPDATE tasks SET source='someday', source_ref=NULL, updated_at=? WHERE id=?`).run(
        now,
        taskId
      )
      // Move subtasks too
      db.prepare(
        `UPDATE tasks SET source='someday', source_ref=NULL, updated_at=? WHERE parent_id=?`
      ).run(now, taskId)
      return { success: true }
    }

    // action === 'file'
    // Always land in today's daily log (visible in today view).
    // project_id / area_id carry the destination association for tagging.
    const todayDate = today()
    let areaId: string | null = null
    let projectId: string | null = null

    if (newProjectName) {
      const proj = db.prepare(`SELECT id FROM projects WHERE name=?`).get(newProjectName) as
        | { id: string }
        | undefined
      if (!proj) {
        const newId = randomUUID()
        db.prepare(
          `INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)`
        ).run(newId, newProjectName, 'active', now, now)
        projectId = newId
      } else {
        projectId = proj.id
      }
    } else if (destination) {
      const resolved = resolveSource(destination)
      if (resolved.source === 'area' && resolved.sourceRef) {
        const row = db.prepare(`SELECT id FROM areas WHERE name=?`).get(resolved.sourceRef) as
          | { id: string }
          | undefined
        areaId = row?.id ?? null
      } else if (resolved.source === 'project' && resolved.sourceRef) {
        const row = db.prepare(`SELECT id FROM projects WHERE name=?`).get(resolved.sourceRef) as
          | { id: string }
          | undefined
        projectId = row?.id ?? null
      }
    } else {
      return { error: 'destination required for action: file' }
    }

    db.prepare(
      `UPDATE tasks SET source='daily', source_ref=?, area_id=?, project_id=?, updated_at=? WHERE id=?`
    ).run(todayDate, areaId, projectId, now, taskId)
    db.prepare(
      `UPDATE tasks SET source='daily', source_ref=?, area_id=?, project_id=?, updated_at=? WHERE parent_id=?`
    ).run(todayDate, areaId, projectId, now, taskId)

    return { success: true, newTaskId: taskId }
  })

  // ── vault:edit-task ──────────────────────────────────────────────────────────

  handle('task-vault:vault:edit-task', async (_event, payload) => {
    const parsed = EditTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, text } = parsed.data
    const extracted = extractTags(text)
    const db = getDb()
    const now = new Date().toISOString()
    const { projectId, areaId } = resolveProjectAndAreaIds(
      db,
      extracted.project,
      extracted.area,
      now
    )
    const changes = db
      .prepare(
        `UPDATE tasks SET text=?,project_id=?,context=?,area_id=?,due_date=?,updated_at=? WHERE id=?`
      )
      .run(
        extracted.text,
        projectId,
        extracted.context ?? null,
        areaId,
        extracted.dueDate ?? null,
        now,
        taskId
      )
    if (changes.changes === 0) return { error: 'STALE_ID' }
    return { success: true }
  })

  // ── vault:delete-task ────────────────────────────────────────────────────────

  handle('task-vault:vault:delete-task', async (_event, payload) => {
    const parsed = DeleteTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    const db = getDb()
    const changes = db
      .prepare(
        `
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
      )
      DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)
    `
      )
      .run(taskId)
    if (changes.changes === 0) return { error: 'STALE_ID' }
    return { success: true }
  })

  // ── vault:cancel-task ────────────────────────────────────────────────────────

  handle('task-vault:vault:cancel-task', async (_event, payload) => {
    const parsed = CancelTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    const changes = db
      .prepare(`UPDATE tasks SET status='cancelled', updated_at=? WHERE id=?`)
      .run(now, taskId)
    if (changes.changes === 0) return { error: 'STALE_ID' }
    return { success: true }
  })

  // ── vault:restore-task ───────────────────────────────────────────────────────

  handle('task-vault:vault:restore-task', async (_event, payload) => {
    const parsed = RestoreTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    const existing = db.prepare(`SELECT metadata FROM tasks WHERE id=?`).get(taskId) as
      | { metadata: string }
      | undefined
    if (!existing) return { error: 'STALE_ID' }
    const meta = JSON.parse(existing.metadata || '{}') as Record<string, unknown>
    const twinId = meta.migration_twin_id as string | undefined
    if (twinId) {
      // Delete all subtasks of the twin, then the twin itself
      db.prepare(`DELETE FROM tasks WHERE parent_id=?`).run(twinId)
      db.prepare(`DELETE FROM tasks WHERE id=?`).run(twinId)
      delete meta.migration_twin_id
    }
    // Restore original subtasks that were migrated alongside this task
    db.prepare(
      `UPDATE tasks SET status='open', migrated_to=NULL, metadata=json_remove(metadata, '$.migration_twin_id'), updated_at=? WHERE parent_id=? AND status='migrated'`
    ).run(now, taskId)
    // Always move back to inbox so the task is findable regardless of original source
    const changes = db
      .prepare(
        `UPDATE tasks SET status='open', source='inbox', source_ref=NULL, completed_date=NULL, migrated_to=NULL, metadata=?, updated_at=? WHERE id=?`
      )
      .run(JSON.stringify(meta), now, taskId)
    if (changes.changes === 0) return { error: 'STALE_ID' }
    return { success: true }
  })

  // ── vault:create-area ────────────────────────────────────────────────────────

  handle('task-vault:vault:create-area', async (_event, payload) => {
    const parsed = CreateAreaRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { name } = parsed.data
    const displayName = toDisplayName(name.trim())
    const db = getDb()
    const now = new Date().toISOString()
    const existing = db.prepare(`SELECT id FROM areas WHERE name=?`).get(displayName)
    if (existing) return { error: 'AREA_EXISTS' }
    db.prepare(`INSERT INTO areas (id,name,created_at) VALUES (?,?,?)`).run(
      randomUUID(),
      displayName,
      now
    )
    return { success: true, filePath: displayName }
  })

  // ── vault:archive-area ───────────────────────────────────────────────────────

  handle('task-vault:vault:archive-area', async (_event, payload) => {
    const parsed = ArchiveAreaRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { areaName } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()

    const area = db.prepare(`SELECT id FROM areas WHERE name=?`).get(areaName) as
      | { id: string }
      | undefined
    if (!area) return { error: 'NOT_FOUND' }

    const projectRows = db.prepare(`SELECT id FROM projects WHERE area_id=?`).all(area.id) as {
      id: string
    }[]

    for (const proj of projectRows) {
      // Cancel all open tasks in each project (recursive via CTE)
      db.prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM tasks WHERE project_id=? AND parent_id IS NULL
           UNION ALL
           SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
         )
         UPDATE tasks SET status='cancelled', updated_at=?
         WHERE id IN (SELECT id FROM subtree)
           AND status IN ('open','in-progress','in-review','blocked')`
      ).run(proj.id, now)
    }

    // Cancel tasks directly in this area (not via a project)
    db.prepare(
      `UPDATE tasks SET status='cancelled', updated_at=?
       WHERE area_id=? AND project_id IS NULL
         AND status IN ('open','in-progress','in-review','blocked')`
    ).run(now, area.id)

    // Archive all projects in this area
    db.prepare(`UPDATE projects SET status='archived', updated_at=? WHERE area_id=?`).run(
      now,
      area.id
    )

    // Archive the area itself
    db.prepare(`UPDATE areas SET status='archived' WHERE id=?`).run(area.id)

    return { success: true }
  })

  // ── vault:delete-area ────────────────────────────────────────────────────────

  handle('task-vault:vault:delete-area', async (_event, payload) => {
    const parsed = DeleteAreaRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { areaFilePath } = parsed.data
    const areaName = path.basename(areaFilePath, '.md')
    const db = getDb()

    const area = db.prepare(`SELECT id, status FROM areas WHERE name=?`).get(areaName) as
      | { id: string; status: string }
      | undefined
    if (!area) return { error: 'NOT_FOUND' }
    if (area.status !== 'archived') return { error: 'MUST_ARCHIVE_FIRST' }

    const projectRows = db.prepare(`SELECT id FROM projects WHERE area_id=?`).all(area.id) as {
      id: string
    }[]

    for (const proj of projectRows) {
      // Delete all tasks in this project (subtasks cascade via parent_id FK)
      db.prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM tasks WHERE project_id=? AND parent_id IS NULL
           UNION ALL
           SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
         )
         DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)`
      ).run(proj.id)
    }

    // Delete tasks directly in this area
    db.prepare(`DELETE FROM tasks WHERE area_id=? AND project_id IS NULL`).run(area.id)

    // Delete all projects in this area
    db.prepare(`DELETE FROM projects WHERE area_id=?`).run(area.id)

    // Delete the area
    db.prepare(`DELETE FROM areas WHERE id=?`).run(area.id)

    return { success: true }
  })

  // ── vault:get-inbox ──────────────────────────────────────────────────────────

  handle('task-vault:vault:get-inbox', async () => {
    try {
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
           WHERE t.source='inbox' AND t.status='open' AND t.parent_id IS NULL ORDER BY t.created_at`
        )
        .all() as Record<string, unknown>[]
      const tasks = rows.map(rowToTask)
      for (const task of tasks) {
        task.subtasks = (
          db
            .prepare(
              `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE t.parent_id=? ORDER BY t.sort_order, t.created_at`
            )
            .all(task.id) as Record<string, unknown>[]
        ).map(rowToTask)
      }
      return { tasks }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:list-areas ─────────────────────────────────────────────────────────

  handle('task-vault:vault:list-areas', async (_event, payload) => {
    try {
      const db = getDb()
      const statusFilter = (payload as { status?: string } | undefined)?.status ?? 'active'
      const areaRows = (
        statusFilter === 'all'
          ? db.prepare(`SELECT * FROM areas ORDER BY name`).all()
          : db.prepare(`SELECT * FROM areas WHERE status=? ORDER BY name`).all(statusFilter)
      ) as Record<string, unknown>[]
      const result: unknown[] = []

      for (const a of areaRows) {
        const areaId = a.id as string
        const areaName = a.name as string
        const taskRows = db
          .prepare(
            `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
             WHERE t.area_id=? AND t.parent_id IS NULL AND t.status NOT IN ('done','cancelled','migrated') ORDER BY t.created_at`
          )
          .all(areaId) as Record<string, unknown>[]
        const tasks = taskRows.map(rowToTask)
        const projectRows = db
          .prepare(`SELECT * FROM projects WHERE area_id=? ORDER BY name`)
          .all(areaId) as Record<string, unknown>[]
        const projects = projectRows.map((p) => {
          const nextActionCount = (
            db
              .prepare(`SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status='open'`)
              .get(p.id) as { c: number }
          ).c
          const totalCount = (
            db
              .prepare(`SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND parent_id IS NULL`)
              .get(p.id) as { c: number }
          ).c
          const doneCount = (
            db
              .prepare(
                `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status IN ('done','cancelled','migrated') AND parent_id IS NULL`
              )
              .get(p.id) as { c: number }
          ).c
          return {
            ...rowToProject(p),
            nextActionCount,
            isStale: nextActionCount === 0,
            totalTaskCount: totalCount,
            doneTaskCount: doneCount,
          }
        })
        // Combined counts: area-direct tasks + tasks from projects in this area
        const combinedOpenCount = (
          db
            .prepare(
              `SELECT COUNT(DISTINCT t.id) as c FROM tasks t WHERE t.parent_id IS NULL AND t.status='open' AND (t.area_id=? OR t.project_id IN (SELECT id FROM projects WHERE area_id=?))`
            )
            .get(areaId, areaId) as { c: number }
        ).c
        const combinedTotalCount = (
          db
            .prepare(
              `SELECT COUNT(DISTINCT t.id) as c FROM tasks t WHERE t.parent_id IS NULL AND (t.area_id=? OR t.project_id IN (SELECT id FROM projects WHERE area_id=?))`
            )
            .get(areaId, areaId) as { c: number }
        ).c
        result.push({
          filePath: areaName,
          name: areaName,
          status: (a.status as string) ?? 'active',
          taskCount: combinedTotalCount,
          openTaskCount: combinedOpenCount,
          tasks,
          projects,
        })
      }

      return { areas: result }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── projects:get-tasks (also registered here for proximity) ─────────────────

  handle('task-vault:projects:get-tasks', async (_event, payload) => {
    const { projectName } = payload as { projectName: string }
    if (!projectName) return { tasks: [] }
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE p.name=? ORDER BY t.status, t.created_at`
      )
      .all(projectName) as Record<string, unknown>[]
    return { tasks: rows.map(rowToTask) }
  })

  // ── vault:list-archive ───────────────────────────────────────────────────────

  handle('task-vault:vault:list-archive', async (_event, payload) => {
    const parsed = ListArchiveRequestSchema.safeParse(payload ?? {})
    const days = parsed.success ? (parsed.data.days ?? 30) : 30
    try {
      const db = getDb()
      const cutoff = localDate(new Date(Date.now() - days * 86400000))
      const taskRows = db
        .prepare(
          `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
           WHERE t.status IN ('done','cancelled','migrated') AND t.updated_at >= ? ORDER BY t.updated_at DESC`
        )
        .all(cutoff) as Record<string, unknown>[]
      const projectRows = db
        .prepare(`SELECT * FROM projects WHERE status='archived' ORDER BY updated_at DESC`)
        .all() as Record<string, unknown>[]
      const projects = projectRows.map(rowToProject)
      return { tasks: taskRows.map(rowToTask), projects }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:list-someday ───────────────────────────────────────────────────────

  handle('task-vault:vault:list-someday', async () => {
    try {
      const db = getDb()
      const taskRows = db
        .prepare(
          `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
           WHERE t.source='someday' AND t.status='open' AND t.parent_id IS NULL
           ORDER BY t.created_at ASC`
        )
        .all() as Record<string, unknown>[]
      const projectRows = db
        .prepare(`SELECT * FROM projects WHERE status='someday' ORDER BY name ASC`)
        .all() as Record<string, unknown>[]
      return { tasks: taskRows.map(rowToTask), projects: projectRows.map(rowToProject) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:someday-to-today ───────────────────────────────────────────────────

  handle('task-vault:vault:someday-to-today', async (_event, payload) => {
    const { taskId } = payload as { taskId: string }
    if (!taskId) return { error: 'VALIDATION_ERROR' }
    try {
      const db = getDb()
      const todayDate = today()
      const now = new Date().toISOString()
      db.prepare(
        `UPDATE tasks SET source='daily', source_ref=?, status='open', updated_at=? WHERE id=?`
      ).run(todayDate, now, taskId)
      db.prepare(
        `UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`
      ).run(todayDate, now, taskId)
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:add-subtask ────────────────────────────────────────────────────────

  handle('task-vault:vault:add-subtask', async (_event, payload) => {
    const { taskId, text } = payload as { taskId: string; text: string }
    if (!taskId || !text) return { error: 'VALIDATION_ERROR' }
    const db = getDb()
    const parent = db.prepare(`SELECT source, source_ref FROM tasks WHERE id=?`).get(taskId) as
      | { source: string; source_ref: string | null }
      | undefined
    if (!parent) return { error: 'STALE_ID' }
    const now = new Date().toISOString()
    const newId = randomUUID()
    db.prepare(
      `INSERT INTO tasks (id,text,status,source,source_ref,parent_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(newId, text.trim(), 'open', parent.source, parent.source_ref, taskId, now, now)
    return { success: true }
  })

  // ── vault:export-json ────────────────────────────────────────────────────────

  handle('task-vault:vault:export-json', async () => {
    try {
      const db = getDb()
      const tasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at`).all()
      const projects = db.prepare(`SELECT * FROM projects ORDER BY name`).all()
      const areas = db.prepare(`SELECT * FROM areas ORDER BY name`).all()
      return {
        exportedAt: new Date().toISOString(),
        version: 1,
        tasks,
        projects,
        areas,
      }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:import-json ────────────────────────────────────────────────────────

  handle('task-vault:vault:import-json', async (_event, payload) => {
    try {
      const data = payload as {
        version?: number
        tasks?: Record<string, unknown>[]
        projects?: Record<string, unknown>[]
        areas?: Record<string, unknown>[]
      }
      if (!data || typeof data !== 'object') return { error: 'INVALID_PAYLOAD' }

      const db = getDb()
      let imported = 0

      if (Array.isArray(data.areas)) {
        const stmt = db.prepare(`INSERT OR IGNORE INTO areas (id,name,created_at) VALUES (?,?,?)`)
        for (const a of data.areas) {
          stmt.run(a.id, a.name, a.created_at)
          imported++
        }
      }
      if (Array.isArray(data.projects)) {
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO projects (id,name,status,area_id,deadline,outcome,terminator_links,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        for (const p of data.projects) {
          const areaId = p.area
            ? ((
                db.prepare(`SELECT id FROM areas WHERE name=?`).get(p.area) as
                  | { id: string }
                  | undefined
              )?.id ?? null)
            : null
          stmt.run(
            p.id,
            p.name,
            p.status ?? 'active',
            areaId,
            p.deadline ?? null,
            p.outcome ?? null,
            p.terminator_links ?? '[]',
            p.created_at,
            p.updated_at
          )
          imported++
        }
      }
      if (Array.isArray(data.tasks)) {
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO tasks
             (id,text,status,project_id,context,area_id,due_date,completed_date,migrated_to,
              source,source_ref,parent_id,sort_order,metadata,terminator_links,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        for (const t of data.tasks) {
          const projectId = t.project
            ? ((
                db.prepare(`SELECT id FROM projects WHERE name=?`).get(t.project) as
                  | { id: string }
                  | undefined
              )?.id ?? null)
            : null
          const areaId = t.area
            ? ((
                db.prepare(`SELECT id FROM areas WHERE name=?`).get(t.area) as
                  | { id: string }
                  | undefined
              )?.id ?? null)
            : null
          stmt.run(
            t.id,
            t.text,
            t.status ?? 'open',
            projectId,
            t.context ?? null,
            areaId,
            t.due_date ?? null,
            t.completed_date ?? null,
            t.migrated_to ?? null,
            t.source ?? 'inbox',
            t.source_ref ?? null,
            t.parent_id ?? null,
            t.sort_order ?? 0,
            t.metadata ?? '{}',
            t.terminator_links ?? '[]',
            t.created_at,
            t.updated_at
          )
          imported++
        }
      }
      return { success: true, imported }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:update-project-status ──────────────────────────────────────────────

  handle('task-vault:vault:update-project-status', async (_event, payload) => {
    const parsed = UpdateProjectStatusRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { projectFilePath: projectName, status } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()

    let proj = db.prepare(`SELECT id FROM projects WHERE name=?`).get(projectName) as
      | { id: string }
      | undefined
    if (!proj) {
      proj = db.prepare(`SELECT id FROM projects WHERE id=?`).get(projectName) as
        | { id: string }
        | undefined
    }
    if (!proj) return { error: 'NOT_FOUND' }

    if (status === 'archived') {
      db.prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM tasks WHERE project_id=? AND parent_id IS NULL
           UNION ALL
           SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
         )
         UPDATE tasks SET status='cancelled', updated_at=?
         WHERE id IN (SELECT id FROM subtree)
           AND status IN ('open','in-progress','in-review','blocked')`
      ).run(proj.id, now)
    }

    db.prepare(`UPDATE projects SET status=?, updated_at=? WHERE id=?`).run(status, now, proj.id)
    return { success: true }
  })

  // ── vault:get-task-detail ────────────────────────────────────────────────────

  handle('task-vault:vault:get-task-detail', async (_event, payload) => {
    const parsed = GetTaskDetailRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    try {
      const db = getDb()
      const row = db.prepare(`SELECT metadata FROM tasks WHERE id=?`).get(taskId) as
        | { metadata: string }
        | undefined
      if (!row) return { error: 'Task not found' }
      const meta = JSON.parse(row.metadata || '{}') as Record<string, string>
      return {
        description: meta.description ?? '',
        acceptanceCriteria: meta.acceptance_criteria ?? '',
        devHints: meta.dev_hints ?? '',
      }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:save-task-detail ───────────────────────────────────────────────────

  handle('task-vault:vault:save-task-detail', async (_event, payload) => {
    const parsed = SaveTaskDetailRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, description, acceptanceCriteria, devHints } = parsed.data
    try {
      const db = getDb()
      const row = db.prepare(`SELECT metadata FROM tasks WHERE id=?`).get(taskId) as
        | { metadata: string }
        | undefined
      if (!row) return { error: 'Task not found' }
      const meta = JSON.parse(row.metadata || '{}') as Record<string, string>
      meta.description = description
      meta.acceptance_criteria = acceptanceCriteria
      meta.dev_hints = devHints
      db.prepare(`UPDATE tasks SET metadata=?, updated_at=? WHERE id=?`).run(
        JSON.stringify(meta),
        new Date().toISOString(),
        taskId
      )
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:reopen-task ────────────────────────────────────────────────────────
  // Sets status back to 'open' in-place (does not move source to inbox).
  // Used by the daily-log view where the task must stay in the current file.

  handle('task-vault:vault:reopen-task', async (_event, payload) => {
    const parsed = RestoreTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    const existing = db.prepare(`SELECT metadata FROM tasks WHERE id=?`).get(taskId) as
      | { metadata: string }
      | undefined
    if (!existing) return { error: 'STALE_ID' }
    const meta = JSON.parse(existing.metadata || '{}') as Record<string, unknown>
    const twinId = meta.migration_twin_id as string | undefined
    if (twinId) {
      // Delete all subtasks of the twin, then the twin itself
      db.prepare(`DELETE FROM tasks WHERE parent_id=?`).run(twinId)
      db.prepare(`DELETE FROM tasks WHERE id=?`).run(twinId)
      delete meta.migration_twin_id
    }
    // Restore original subtasks that were migrated alongside this task
    db.prepare(
      `UPDATE tasks SET status='open', migrated_to=NULL, metadata=json_remove(metadata, '$.migration_twin_id'), updated_at=? WHERE parent_id=? AND status='migrated'`
    ).run(now, taskId)
    const changes = db
      .prepare(
        `UPDATE tasks SET status='open', completed_date=NULL, migrated_to=NULL, metadata=?, updated_at=? WHERE id=?`
      )
      .run(JSON.stringify(meta), now, taskId)
    if (changes.changes === 0) return { error: 'STALE_ID' }
    return { success: true }
  })

  // ── vault:block-task ──────────────────────────────────────────────────────────

  handle('task-vault:vault:block-task', async (_event, payload) => {
    const parsed = BlockTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR: ' + parsed.error.message }
    const { taskId, reason, checkInterval } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`SELECT metadata FROM tasks WHERE id=?`).get(taskId) as
      | { metadata: string }
      | undefined
    if (!row) return { error: 'STALE_ID' }
    const meta = JSON.parse(row.metadata || '{}') as Record<string, string>
    meta.blocked_reason = reason
    meta.blocked_check_interval = checkInterval
    const changes = db
      .prepare(`UPDATE tasks SET status='blocked', metadata=?, updated_at=? WHERE id=?`)
      .run(JSON.stringify(meta), now, taskId)
    if (changes.changes === 0) return { error: 'STALE_ID' }
    triggerSchedulerTick()
    return { success: true }
  })

  // ── vault:unblock-task ────────────────────────────────────────────────────────

  handle('task-vault:vault:unblock-task', async (_event, payload) => {
    const parsed = UnblockTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`SELECT metadata FROM tasks WHERE id=?`).get(taskId) as
      | { metadata: string }
      | undefined
    if (!row) return { error: 'STALE_ID' }
    const meta = JSON.parse(row.metadata || '{}') as Record<string, string>
    delete meta.blocked_reason
    delete meta.blocked_check_interval
    const changes = db
      .prepare(`UPDATE tasks SET status='open', metadata=?, updated_at=? WHERE id=?`)
      .run(JSON.stringify(meta), now, taskId)
    if (changes.changes === 0) return { error: 'STALE_ID' }
    return { success: true }
  })

  // ── vault:set-recurrence ──────────────────────────────────────────────────────

  handle('task-vault:vault:set-recurrence', async (_event, payload) => {
    const parsed = SetRecurrenceRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, interval, days, time, endType, endDate, endCount } = parsed.data
    const db = getDb()
    const task = db
      .prepare(`SELECT metadata, due_date, source_ref FROM tasks WHERE id=?`)
      .get(taskId) as
      | { metadata: string; due_date: string | null; source_ref: string | null }
      | undefined
    if (!task) return { error: 'STALE_ID' }

    // Build recurrence_rule column value from interval + days
    let recurrenceRule = interval
    if (interval === 'weekly' && days != null && days.length > 0) {
      recurrenceRule = `weekly:${[...days].sort((a, b) => a - b).join(',')}`
    }

    // Build end-condition metadata (configuration keys remain in metadata)
    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(task.metadata || '{}') as Record<string, unknown>
    } catch {
      // ignore
    }
    meta.recurrence_end_type = endType ?? 'none'
    meta.recurrence_end_date = endType === 'on_date' ? endDate : undefined
    meta.recurrence_end_count = endType === 'after_count' ? endCount : undefined
    // Reset completion count when recurrence is (re)configured
    meta.recurrence_completed_count = 0
    // Remove stale metadata-based recurrence keys
    delete meta.recurrence_interval
    delete meta.recurrence_days
    delete meta.recurrence_time
    delete meta.recurrence_next_spawned
    delete meta.notification_notified_date

    const now = new Date().toISOString()
    // Ensure due_date is set. Daily log tasks have no due_date by default.
    const effectiveDueDate = task.due_date ?? task.source_ref ?? today()

    try {
      let nextTaskId: string | null = null
      const setAndSpawn = db.transaction(() => {
        // Delete any stale future open instances before resetting the rule
        db.prepare(
          `DELETE FROM tasks WHERE recurrence_template_id=? AND status='open' AND due_date > ?`
        ).run(taskId, today())

        db.prepare(
          `UPDATE tasks SET recurrence_rule=?, recurrence_notify_at=?, due_date=?, metadata=?, updated_at=? WHERE id=?`
        ).run(recurrenceRule, time ?? null, effectiveDueDate, JSON.stringify(meta), now, taskId)

        nextTaskId = ensureNextOccurrence(db, taskId)
      })
      setAndSpawn()

      if (nextTaskId) {
        broadcast('task-vault:recurrence-spawned', { taskId, nextTaskId })
      }
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { error: msg }
    }
  })

  // ── vault:clear-recurrence ────────────────────────────────────────────────────

  handle('task-vault:vault:clear-recurrence', async (_event, payload) => {
    const parsed = ClearRecurrenceRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    const db = getDb()
    const task = db.prepare(`SELECT metadata FROM tasks WHERE id=?`).get(taskId) as
      | { metadata: string }
      | undefined
    if (!task) return { error: 'STALE_ID' }
    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(task.metadata || '{}') as Record<string, unknown>
    } catch {
      // ignore
    }
    // Remove all recurrence-related keys from metadata
    delete meta.recurrence_interval
    delete meta.recurrence_days
    delete meta.recurrence_time
    delete meta.recurrence_end_type
    delete meta.recurrence_end_date
    delete meta.recurrence_end_count
    delete meta.recurrence_completed_count
    delete meta.recurrence_next_spawned
    delete meta.notification_notified_date
    const now = new Date().toISOString()
    const clearTx = db.transaction(() => {
      // Delete all future open instances
      db.prepare(`DELETE FROM tasks WHERE recurrence_template_id=? AND status='open'`).run(taskId)
      db.prepare(
        `UPDATE tasks SET recurrence_rule=NULL, recurrence_notify_at=NULL, metadata=?, updated_at=? WHERE id=?`
      ).run(JSON.stringify(meta), now, taskId)
    })
    clearTx()
    return { success: true }
  })

  // ── vault:reorder-tasks ───────────────────────────────────────────────────────

  handle('task-vault:vault:reorder-tasks', async (_event, payload) => {
    const parsed = ReorderTasksRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { orderedIds } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    const stmt = db.prepare(`UPDATE tasks SET sort_order=?, updated_at=? WHERE id=?`)
    const updateMany = db.transaction((ids: string[]) => {
      for (let i = 0; i < ids.length; i++) {
        stmt.run(i, now, ids[i])
      }
    })
    updateMany(orderedIds)
    return { success: true }
  })

  // ── vault:get-calendar-month ──────────────────────────────────────────────────

  handle('task-vault:vault:get-calendar-month', async (_event, payload) => {
    const { year, month } = payload as { year: number; month: number }
    const db = getDb()
    const pad = (n: number) => String(n).padStart(2, '0')
    const startDate = `${year}-${pad(month)}-01`
    const endDate = `${year}-${pad(month)}-31`
    type DayRow = { date: string; status: string; count: number }
    const rows = db
      .prepare(
        `SELECT source_ref AS date, status, COUNT(*) AS count
         FROM tasks
         WHERE source='daily' AND source_ref >= ? AND source_ref <= ?
           AND parent_id IS NULL
         GROUP BY source_ref, status`
      )
      .all(startDate, endDate) as DayRow[]
    return { days: rows }
  })

  return () => {
    for (const [channel] of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
