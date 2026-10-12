import { z } from 'zod'
import * as path from 'node:path'
import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { noPayload } from '@terminator/extension-sdk'
import { createIpcRegistrar, errorResult } from './register'
import { insertTask } from '../vault/task-repository'
import { randomUUID } from '../vault/db'
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
  RenameAreaRequestSchema,
  ListAreasRequestSchema,
  GetProjectTasksRequestSchema,
  AddSubtaskRequestSchema,
  CalendarMonthRequestSchema,
  StaleThresholdRequestSchema,
} from '../schemas/vault.schema'
import { triggerSchedulerTick, broadcast } from '../notifications/task-scheduler.js'
import { archiveAreaContents, restoreAreaContents } from '../vault/area-archive'
import { setProjectStatus } from '../vault/project-status'
import { dailyTasks, reopenTask, taskMetadata } from '../vault/task-reads'
import {
  rowToTask,
  rowToProject,
  TASK_COLS,
  TASK_JOINS,
  PROJECT_COLS,
  PROJECT_JOINS,
} from '../vault/mappers'

const localDate = _localDate

/** The export writes ids; older payloads name the project or area instead. */
async function findImportedId(
  db: ExtensionDB,
  table: 'projects' | 'areas',
  id: unknown,
  name: unknown
): Promise<string | null> {
  const [column, value] = id ? ['id', id] : ['name', name]
  if (!value) return null
  const row = await db.get<{ id: string }>(`SELECT id FROM ${table} WHERE ${column}=?`, [value])
  return row?.id ?? null
}

/** One task as written by the JSON export. */
interface ImportedTask {
  id: string
  text: string
  created_at: string
  updated_at: string
  status?: string
  project_id?: string | null
  area_id?: string | null
  project?: string | null
  area?: string | null
  context?: string | null
  due_date?: string | null
  completed_date?: string | null
  migrated_to?: string | null
  source?: string
  source_ref?: string | null
  parent_id?: string | null
  sort_order?: number
  metadata?: string
  terminator_links?: string
}

/** The JSON export's shape; rows are written as exported, unknown columns ignored. */
const ImportJsonRequestSchema = z.object({
  version: z.number().optional(),
  tasks: z
    .array(z.custom<ImportedTask>((task) => typeof task === 'object' && task !== null))
    .optional(),
  projects: z.array(z.record(z.unknown())).optional(),
  areas: z.array(z.record(z.unknown())).optional(),
})

function today(): string {
  return localDate()
}

function resolveSource(filePath: string): { source: string; sourceRef: string | null } {
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

async function resolveProjectAndAreaIds(
  db: ExtensionDB,
  project: string | undefined,
  area: string | undefined,
  now: string
): Promise<{ projectId: string | null; areaId: string | null }> {
  const areaName = area ? toDisplayName(area) : undefined
  const projectName = project ? toDisplayName(project) : undefined

  let areaId: string | null = null
  if (areaName) {
    const existingArea = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [
      areaName,
    ])
    if (existingArea) {
      areaId = existingArea.id
    } else {
      areaId = randomUUID()
      await db.run(
        `INSERT INTO areas (id,name,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,
        [areaId, areaName, now, now]
      )
    }
  }

  let projectId: string | null = null
  if (projectName) {
    const existingProject = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [
      projectName,
    ])
    if (existingProject) {
      projectId = existingProject.id
    } else {
      projectId = randomUUID()
      await db.run(
        `INSERT INTO projects (id,name,status,area_id,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        [projectId, projectName, 'active', areaId, now, now]
      )
    }
  }

  return { projectId, areaId }
}

export function registerVaultIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handle, handleRemote, cleanup } = createIpcRegistrar(api, errorResult)

  handleRemote('task-vault:vault:capture', CaptureRequestSchema, async (args) => {
    const { text, hintArea, hintProject } = args

    const tags: string[] = []
    if (hintProject) tags.push(`@${hintProject}`)
    if (hintArea) tags.push(`#${hintArea}`)
    const fullText = tags.length ? `${text} ${tags.join(' ')}` : text
    const extracted = extractTags(fullText)

    const now = new Date().toISOString()
    const id = randomUUID()
    const { projectId, areaId } = await resolveProjectAndAreaIds(
      db,
      extracted.project,
      extracted.area,
      now
    )
    await insertTask(db, {
      id,
      text: extracted.text,
      status: 'open',
      projectId,
      context: extracted.context ?? null,
      areaId,
      dueDate: extracted.dueDate ?? null,
      source: 'inbox',
      createdAt: now,
      updatedAt: now,
    })
    broadcast('task-vault:push:index-updated', {})
    return { taskId: id }
  })

  handleRemote('task-vault:vault:get-today', noPayload, async () => {
    try {
      const date = today()
      const now = new Date().toISOString()

      const staleRows = await db.query<Record<string, unknown>>(
        `SELECT t.id, t.text, p.name AS project, t.context, a.name AS area, t.due_date, t.project_id, t.area_id, t.source_ref, t.today_since
         FROM tasks t ${TASK_JOINS}
         WHERE t.source='daily' AND t.source_ref < ? AND t.source_ref IS NOT NULL
           AND t.status IN ('open','in-progress','blocked') AND t.parent_id IS NULL
           AND t.recurrence_rule IS NULL`,
        [date]
      )

      const rolledOverIds: string[] = []
      if (staleRows.length > 0) {
        await db.transaction(async (tx) => {
          for (const row of staleRows) {
            const newId = randomUUID()
            const inheritedTodaySince =
              (row.today_since as string) || (row.source_ref as string) || date
            await insertTask(
              tx,
              {
                id: newId,
                text: row.text as string,
                status: 'open',
                projectId: (row.project_id as string) ?? null,
                context: (row.context as string) ?? null,
                areaId: (row.area_id as string) ?? null,
                dueDate: (row.due_date as string) ?? null,
                source: 'daily',
                sourceRef: date,
                todaySince: inheritedTodaySince,
                createdAt: now,
                updatedAt: now,
              },
              { orIgnore: true }
            )
            await tx.run(
              `UPDATE tasks SET status='migrated', migrated_to=?, updated_at=? WHERE id=?`,
              [date, now, row.id as string]
            )
            await tx.run(
              `UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`,
              [date, now, row.id as string]
            )
            rolledOverIds.push(newId)
          }
        })
      }

      const tasks = await dailyTasks(db, date)
      const thresholdRow = await db.get<{ value: string }>(
        `SELECT value FROM settings WHERE extension_id='task-vault' AND key='stale_days_threshold'`
      )
      const staleDaysThreshold = thresholdRow ? parseInt(thresholdRow.value, 10) || 7 : 7

      return {
        date,
        filePath: `daily/${date}.md`,
        tasks,
        rolledOver: staleRows.length,
        rolledOverIds,
        exists: tasks.length > 0,
        staleDaysThreshold,
      }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleRemote('task-vault:vault:get-daily', GetDailyRequestSchema, async (args) => {
    try {
      const { date } = args
      const tasks = await dailyTasks(db, date)
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

  handleRemote('task-vault:vault:add-task', AddTaskRequestSchema, async (args) => {
    const { filePath, text, dueDate, tags } = args

    const parts: string[] = [text]
    if (tags?.project) parts.push(`@${tags.project}`)
    if (tags?.context) parts.push(`+${tags.context}`)
    if (tags?.area) parts.push(`#${tags.area}`)
    if (dueDate) parts.push(`due:${dueDate}`)
    const fullText = parts.join(' ')
    const extracted = extractTags(fullText)

    const { source, sourceRef } = resolveSource(filePath)
    const now = new Date().toISOString()
    const id = randomUUID()
    const { projectId, areaId } = await resolveProjectAndAreaIds(
      db,
      extracted.project,
      extracted.area,
      now
    )
    const todaySinceVal = source === 'daily' ? (sourceRef ?? null) : null
    await insertTask(db, {
      id,
      text: extracted.text,
      status: 'open',
      projectId,
      context: extracted.context ?? null,
      areaId,
      dueDate: extracted.dueDate ?? null,
      source,
      sourceRef,
      todaySince: todaySinceVal,
      createdAt: now,
      updatedAt: now,
    })
    broadcast('task-vault:push:index-updated', {})
    return { taskId: id }
  })

  handleRemote('task-vault:vault:complete-task', CompleteTaskRequestSchema, async (args) => {
    const { taskId } = args
    const now = new Date().toISOString()
    const todayStr = today()

    try {
      let nextTaskId: string | null = null
      await db.transaction(async (tx) => {
        const existing = await tx.get<{ id: string }>(`SELECT id FROM tasks WHERE id=?`, [taskId])
        if (!existing) throw new Error('STALE_ID')
        await tx.run(`UPDATE tasks SET status='done', completed_date=?, updated_at=? WHERE id=?`, [
          todayStr,
          now,
          taskId,
        ])
        nextTaskId = await ensureNextOccurrence(tx, taskId)
      })

      if (nextTaskId) {
        const nextRow = await db.get<{ due_date: string }>(
          `SELECT due_date FROM tasks WHERE id=?`,
          [nextTaskId]
        )
        broadcast('task-vault:recurrence-spawned', {
          taskId,
          nextTaskId,
          nextDue: nextRow?.due_date,
        })
      }

      broadcast('task-vault:push:index-updated', {})
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'STALE_ID') return { error: 'STALE_ID' }
      return { error: msg }
    }
  })

  handleRemote('task-vault:vault:migrate-task', MigrateTaskRequestSchema, async (args) => {
    const { taskId, targetDate } = args
    const task = await db.get<Record<string, unknown>>(
      `SELECT t.*, t.project_id, t.area_id FROM tasks t WHERE t.id=?`,
      [taskId]
    )
    if (!task) return { error: 'STALE_ID' }
    if ((task.source_ref as string | null) === targetDate) return { newTaskId: taskId, noop: true }
    const now = new Date().toISOString()
    const newId = randomUUID()
    const existingMeta = JSON.parse((task.metadata as string) || '{}') as Record<string, unknown>
    existingMeta.migration_twin_id = newId
    await db.run(
      `UPDATE tasks SET status='migrated', migrated_to=?, metadata=?, updated_at=? WHERE id=?`,
      [targetDate, JSON.stringify(existingMeta), now, taskId]
    )
    const originalStatus = task.status as string
    const twinStatus =
      originalStatus === 'done' || originalStatus === 'cancelled' ? originalStatus : 'open'
    await insertTask(db, {
      id: newId,
      text: task.text as string,
      status: twinStatus,
      projectId: (task.project_id as string) ?? null,
      context: (task.context as string) ?? null,
      areaId: (task.area_id as string) ?? null,
      dueDate: (task.due_date as string) ?? null,
      source: 'daily',
      sourceRef: targetDate,
      createdAt: now,
      updatedAt: now,
    })
    type SubRow = {
      id: string
      text: string
      status: string
      sort_order: number | null
      metadata: string
    }
    const subtasks = await db.query<SubRow>(
      `SELECT id, text, status, sort_order, metadata FROM tasks WHERE parent_id=? ORDER BY sort_order, created_at`,
      [taskId]
    )
    for (const sub of subtasks) {
      const subTwinId = randomUUID()
      const subMeta = JSON.parse(sub.metadata || '{}') as Record<string, unknown>
      subMeta.migration_twin_id = subTwinId
      await db.run(
        `UPDATE tasks SET status='migrated', migrated_to=?, metadata=?, updated_at=? WHERE id=?`,
        [targetDate, JSON.stringify(subMeta), now, sub.id]
      )
      const subTwinStatus =
        sub.status === 'done' || sub.status === 'cancelled' ? sub.status : 'open'
      await insertTask(db, {
        id: subTwinId,
        text: sub.text,
        status: subTwinStatus,
        parentId: newId,
        sortOrder: sub.sort_order ?? 0,
        source: 'daily',
        sourceRef: targetDate,
        createdAt: now,
        updatedAt: now,
      })
    }
    broadcast('task-vault:push:index-updated', {})
    return { newTaskId: newId }
  })

  handleRemote('task-vault:vault:query', QueryRequestSchema, async (args) => {
    const { status, context, project, area, dueBefore } = args

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
    const rows = await db.query<Record<string, unknown>>(
      `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} ${where} ORDER BY t.created_at`,
      params
    )
    return { tasks: rows.map(rowToTask) }
  })

  handleRemote('task-vault:vault:process-inbox-item', ProcessInboxRequestSchema, async (args) => {
    const { taskId, action, destination, newProjectName } = args
    const now = new Date().toISOString()

    const task = await db.get<Record<string, unknown>>(`SELECT * FROM tasks WHERE id=?`, [taskId])
    if (!task) return { error: 'STALE_ID' }

    if (action === 'trash') {
      const archiveNow = new Date().toISOString()
      await db.run(
        `WITH RECURSIVE subtree(id) AS (
          SELECT id FROM tasks WHERE id = ?
          UNION ALL
          SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
        )
        UPDATE tasks SET status='cancelled', updated_at=? WHERE id IN (SELECT id FROM subtree)`,
        [taskId, archiveNow]
      )
      broadcast('task-vault:push:index-updated', {})
      return { success: true }
    }

    if (action === 'do-now') {
      const todayDate = today()
      await db.run(
        `UPDATE tasks SET status='in-progress', source='daily', source_ref=?, updated_at=? WHERE id=?`,
        [todayDate, now, taskId]
      )
      await db.run(
        `UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`,
        [todayDate, now, taskId]
      )
      broadcast('task-vault:push:index-updated', {})
      return { success: true }
    }

    if (action === 'someday') {
      await db.run(
        `UPDATE tasks SET source='someday', source_ref=NULL, today_since=NULL, updated_at=? WHERE id=?`,
        [now, taskId]
      )
      await db.run(
        `UPDATE tasks SET source='someday', source_ref=NULL, today_since=NULL, updated_at=? WHERE parent_id=?`,
        [now, taskId]
      )
      broadcast('task-vault:push:index-updated', {})
      return { success: true }
    }

    // action === 'file'
    const todayDate = today()
    let areaId: string | null = null
    let projectId: string | null = null

    if (newProjectName) {
      const proj = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [
        newProjectName,
      ])
      if (!proj) {
        const newId = randomUUID()
        await db.run(
          `INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)`,
          [newId, newProjectName, 'active', now, now]
        )
        projectId = newId
      } else {
        projectId = proj.id
      }
    } else if (destination) {
      const resolved = resolveSource(destination)
      if (resolved.source === 'area' && resolved.sourceRef) {
        const row = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [
          resolved.sourceRef,
        ])
        areaId = row?.id ?? null
      } else if (resolved.source === 'project' && resolved.sourceRef) {
        const row = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [
          resolved.sourceRef,
        ])
        projectId = row?.id ?? null
      }
    } else {
      return { error: 'destination required for action: file' }
    }

    await db.run(
      `UPDATE tasks SET source='daily', source_ref=?, area_id=?, project_id=?, updated_at=? WHERE id=?`,
      [todayDate, areaId, projectId, now, taskId]
    )
    await db.run(
      `UPDATE tasks SET source='daily', source_ref=?, area_id=?, project_id=?, updated_at=? WHERE parent_id=?`,
      [todayDate, areaId, projectId, now, taskId]
    )

    broadcast('task-vault:push:index-updated', {})
    return { success: true, newTaskId: taskId }
  })

  handleRemote('task-vault:vault:edit-task', EditTaskRequestSchema, async (args) => {
    const { taskId, text } = args
    const extracted = extractTags(text)
    const now = new Date().toISOString()
    const { projectId, areaId } = await resolveProjectAndAreaIds(
      db,
      extracted.project,
      extracted.area,
      now
    )
    const existing = await db.get<{ id: string }>(`SELECT id FROM tasks WHERE id=?`, [taskId])
    if (!existing) return { error: 'STALE_ID' }
    await db.run(
      `UPDATE tasks SET text=?,project_id=?,context=?,area_id=?,due_date=?,updated_at=? WHERE id=?`,
      [
        extracted.text,
        projectId,
        extracted.context ?? null,
        areaId,
        extracted.dueDate ?? null,
        now,
        taskId,
      ]
    )
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:delete-task', DeleteTaskRequestSchema, async (args) => {
    const { taskId } = args
    const existing = await db.get<{ id: string }>(`SELECT id FROM tasks WHERE id=?`, [taskId])
    if (!existing) return { error: 'STALE_ID' }
    await db.run(
      `WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
      )
      DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)`,
      [taskId]
    )
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:cancel-task', CancelTaskRequestSchema, async (args) => {
    const { taskId } = args
    const now = new Date().toISOString()
    const existing = await db.get<{ id: string }>(`SELECT id FROM tasks WHERE id=?`, [taskId])
    if (!existing) return { error: 'STALE_ID' }
    await db.run(`UPDATE tasks SET status='cancelled', updated_at=? WHERE id=?`, [now, taskId])
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:restore-task', RestoreTaskRequestSchema, async (args) => {
    if (!(await reopenTask(db, args.taskId, today()))) return { error: 'STALE_ID' }
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:create-area', CreateAreaRequestSchema, async (args) => {
    const { name } = args
    const displayName = toDisplayName(name.trim())
    const now = new Date().toISOString()
    const existing = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [
      displayName,
    ])
    if (existing) return { error: 'AREA_EXISTS' }
    await db.run(`INSERT INTO areas (id,name,created_at,updated_at) VALUES (?,?,?,?)`, [
      randomUUID(),
      displayName,
      now,
      now,
    ])
    broadcast('task-vault:push:index-updated', {})
    return { success: true, filePath: displayName }
  })

  handleRemote('task-vault:vault:rename-area', RenameAreaRequestSchema, async (args) => {
    const { areaFilePath, newName } = args
    const now = new Date().toISOString()
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
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:archive-area', ArchiveAreaRequestSchema, async (args) => {
    const { areaName } = args
    const now = new Date().toISOString()

    const area = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [areaName])
    if (!area) return { error: 'NOT_FOUND' }

    await archiveAreaContents(db, area.id, now)
    await db.run(`UPDATE areas SET status='archived', updated_at=? WHERE id=?`, [now, area.id])

    api.notifications.createNotification({
      type: 'info',
      title: 'Area archived',
      message: areaName,
      key: 'areaArchived',
    })
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:delete-area', DeleteAreaRequestSchema, async (args) => {
    const { areaFilePath } = args
    const areaName = path.basename(areaFilePath, '.md')

    const area = await db.get<{ id: string; status: string }>(
      `SELECT id, status FROM areas WHERE name=?`,
      [areaName]
    )
    if (!area) return { error: 'NOT_FOUND' }
    if (area.status !== 'archived') return { error: 'MUST_ARCHIVE_FIRST' }

    const projectRows = await db.query<{ id: string }>(`SELECT id FROM projects WHERE area_id=?`, [
      area.id,
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

    await db.run(`DELETE FROM tasks WHERE area_id=? AND project_id IS NULL`, [area.id])
    await db.run(`DELETE FROM projects WHERE area_id=?`, [area.id])
    await db.run(`DELETE FROM areas WHERE id=?`, [area.id])

    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:restore-area', ArchiveAreaRequestSchema, async (args) => {
    const { areaName } = args
    const now = new Date().toISOString()
    const area = await db.get<{ id: string; updated_at: string }>(
      `SELECT id, updated_at FROM areas WHERE name=?`,
      [areaName]
    )
    if (!area) return { error: 'NOT_FOUND' }
    await db.run(`UPDATE areas SET status='active', updated_at=? WHERE id=?`, [now, area.id])
    await restoreAreaContents(db, { id: area.id, archivedAt: area.updated_at }, now)
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:get-inbox', noPayload, async () => {
    try {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
         WHERE t.source='inbox' AND t.status='open' AND t.parent_id IS NULL ORDER BY t.created_at`
      )
      const tasks = rows.map(rowToTask)
      for (const task of tasks) {
        const subtaskRows = await db.query<Record<string, unknown>>(
          `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE t.parent_id=? ORDER BY t.sort_order, t.created_at`,
          [task.id]
        )
        task.subtasks = subtaskRows.map(rowToTask)
      }
      return { tasks }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleRemote('task-vault:vault:list-areas', ListAreasRequestSchema, async (args) => {
    try {
      const statusFilter = args.status ?? 'active'
      const areaRows =
        statusFilter === 'all'
          ? await db.query<Record<string, unknown>>(`SELECT * FROM areas ORDER BY name`)
          : await db.query<Record<string, unknown>>(
              `SELECT * FROM areas WHERE status=? ORDER BY name`,
              [statusFilter]
            )
      const result: unknown[] = []

      for (const a of areaRows) {
        const areaId = a.id as string
        const areaName = a.name as string
        const taskRows = await db.query<Record<string, unknown>>(
          `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
           WHERE t.area_id=? AND t.parent_id IS NULL AND t.status NOT IN ('done','cancelled','migrated') ORDER BY t.created_at`,
          [areaId]
        )
        const tasks = taskRows.map(rowToTask)
        const projectRows = await db.query<Record<string, unknown>>(
          `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.area_id=? ORDER BY p.name`,
          [areaId]
        )
        const projects = await Promise.all(
          projectRows.map(async (p) => {
            const ncRow = await db.get<{ c: string }>(
              `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status='open'`,
              [p.id as string]
            )
            const nextActionCount = Number(ncRow?.c ?? 0)
            const totalRow = await db.get<{ c: string }>(
              `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND parent_id IS NULL`,
              [p.id as string]
            )
            const totalCount = Number(totalRow?.c ?? 0)
            const doneRow = await db.get<{ c: string }>(
              `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status IN ('done','cancelled','migrated') AND parent_id IS NULL`,
              [p.id as string]
            )
            const doneCount = Number(doneRow?.c ?? 0)
            return {
              ...rowToProject(p),
              nextActionCount,
              isStale: nextActionCount === 0,
              totalTaskCount: totalCount,
              doneTaskCount: doneCount,
            }
          })
        )
        const openRow = await db.get<{ c: string }>(
          `SELECT COUNT(DISTINCT t.id) as c FROM tasks t WHERE t.parent_id IS NULL AND t.status='open' AND (t.area_id=? OR t.project_id IN (SELECT id FROM projects WHERE area_id=?))`,
          [areaId, areaId]
        )
        const combinedOpenCount = Number(openRow?.c ?? 0)
        const totalRow2 = await db.get<{ c: string }>(
          `SELECT COUNT(DISTINCT t.id) as c FROM tasks t WHERE t.parent_id IS NULL AND (t.area_id=? OR t.project_id IN (SELECT id FROM projects WHERE area_id=?))`,
          [areaId, areaId]
        )
        const combinedTotalCount = Number(totalRow2?.c ?? 0)
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

  handleRemote('task-vault:projects:get-tasks', GetProjectTasksRequestSchema, async (args) => {
    const { projectName } = args
    if (!projectName) return { tasks: [] }
    const rows = await db.query<Record<string, unknown>>(
      `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE p.name=? ORDER BY t.status, t.created_at`,
      [projectName]
    )
    return { tasks: rows.map(rowToTask) }
  })

  handleRemote(
    'task-vault:vault:list-archive',
    ListArchiveRequestSchema.default({}),
    async (args) => {
      const days = args.days ?? 30
      try {
        const cutoff = localDate(new Date(Date.now() - days * 86400000))
        const taskRows = await db.query<Record<string, unknown>>(
          `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
         WHERE t.status IN ('done','cancelled','migrated') AND t.updated_at >= ? ORDER BY t.updated_at DESC`,
          [cutoff]
        )
        const projectRows = await db.query<Record<string, unknown>>(
          `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status='archived' ORDER BY p.updated_at DESC`
        )
        const areaRows = await db.query<Record<string, unknown>>(
          `SELECT * FROM areas WHERE status='archived' ORDER BY updated_at DESC`
        )
        const projects = projectRows.map(rowToProject)
        const areas = areaRows.map((a) => ({
          id: a.id as string,
          name: a.name as string,
          updatedAt: a.updated_at as string,
        }))
        return { tasks: taskRows.map(rowToTask), projects, areas }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  handleRemote('task-vault:vault:list-someday', noPayload, async () => {
    try {
      const taskRows = await db.query<Record<string, unknown>>(
        `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
         WHERE t.source='someday' AND t.status='open' AND t.parent_id IS NULL
         ORDER BY t.created_at ASC`
      )
      const projectRows = await db.query<Record<string, unknown>>(
        `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status='someday' ORDER BY p.name ASC`
      )
      return { tasks: taskRows.map(rowToTask), projects: projectRows.map(rowToProject) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleRemote('task-vault:vault:someday-to-today', CompleteTaskRequestSchema, async (args) => {
    const { taskId } = args
    try {
      const todayDate = today()
      const now = new Date().toISOString()
      await db.run(
        `UPDATE tasks SET source='daily', source_ref=?, status='open', updated_at=? WHERE id=?`,
        [todayDate, now, taskId]
      )
      await db.run(
        `UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`,
        [todayDate, now, taskId]
      )
      broadcast('task-vault:push:index-updated', {})
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleRemote('task-vault:vault:add-subtask', AddSubtaskRequestSchema, async (args) => {
    const { taskId, text } = args
    const parent = await db.get<{ source: string; source_ref: string | null }>(
      `SELECT source, source_ref FROM tasks WHERE id=?`,
      [taskId]
    )
    if (!parent) return { error: 'STALE_ID' }
    const now = new Date().toISOString()
    const newId = randomUUID()
    await insertTask(db, {
      id: newId,
      text: text.trim(),
      status: 'open',
      source: parent.source,
      sourceRef: parent.source_ref,
      parentId: taskId,
      createdAt: now,
      updatedAt: now,
    })
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handle('task-vault:vault:export-json', noPayload, async () => {
    try {
      const tasks = await db.query(`SELECT * FROM tasks ORDER BY created_at`)
      const projects = await db.query(`SELECT * FROM projects ORDER BY name`)
      const areas = await db.query(`SELECT * FROM areas ORDER BY name`)
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

  handle('task-vault:vault:import-json', ImportJsonRequestSchema, async (data) => {
    try {
      let imported = 0

      if (data.areas) {
        for (const a of data.areas) {
          await db.run(
            `INSERT INTO areas (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`,
            [a.id, a.name, a.status ?? 'active', a.created_at, a.updated_at ?? a.created_at]
          )
          imported++
        }
      }
      if (data.projects) {
        for (const p of data.projects) {
          const areaId = await findImportedId(db, 'areas', p.area_id, p.area)
          await db.run(
            `INSERT INTO projects (id,name,status,area_id,deadline,outcome,terminator_links,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
            [
              p.id,
              p.name,
              p.status ?? 'active',
              areaId,
              p.deadline ?? null,
              p.outcome ?? null,
              p.terminator_links ?? '[]',
              p.created_at,
              p.updated_at,
            ]
          )
          imported++
        }
      }
      if (data.tasks) {
        for (const t of data.tasks) {
          const projectId = await findImportedId(db, 'projects', t.project_id, t.project)
          const areaId = await findImportedId(db, 'areas', t.area_id, t.area)
          await insertTask(
            db,
            {
              id: t.id,
              text: t.text,
              status: t.status ?? 'open',
              projectId,
              context: t.context ?? null,
              areaId,
              dueDate: t.due_date ?? null,
              completedDate: t.completed_date ?? null,
              migratedTo: t.migrated_to ?? null,
              source: t.source ?? 'inbox',
              sourceRef: t.source_ref ?? null,
              parentId: t.parent_id ?? null,
              sortOrder: t.sort_order ?? 0,
              metadata: t.metadata ?? '{}',
              terminatorLinks: t.terminator_links ?? '[]',
              createdAt: t.created_at,
              updatedAt: t.updated_at,
            },
            { orIgnore: true }
          )
          imported++
        }
      }
      return { success: true, imported }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleRemote(
    'task-vault:vault:update-project-status',
    UpdateProjectStatusRequestSchema,
    async (args) => {
      const { projectFilePath: projectName, status } = args
      if (!(await setProjectStatus(db, projectName, status))) return { error: 'NOT_FOUND' }
      if (status === 'archived') {
        api.notifications.createNotification({
          type: 'info',
          title: 'Project archived',
          message: projectName,
          key: 'projectArchived',
        })
      }
      broadcast('task-vault:push:index-updated', {})
      return { success: true }
    }
  )

  handleRemote('task-vault:vault:get-task-detail', GetTaskDetailRequestSchema, async (args) => {
    const { taskId } = args
    try {
      const row = await db.get<{ metadata: string }>(`SELECT metadata FROM tasks WHERE id=?`, [
        taskId,
      ])
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

  handleRemote('task-vault:vault:save-task-detail', SaveTaskDetailRequestSchema, async (args) => {
    const { taskId, description, acceptanceCriteria, devHints } = args
    try {
      const row = await db.get<{ metadata: string }>(`SELECT metadata FROM tasks WHERE id=?`, [
        taskId,
      ])
      if (!row) return { error: 'Task not found' }
      const meta = JSON.parse(row.metadata || '{}') as Record<string, string>
      meta.description = description
      meta.acceptance_criteria = acceptanceCriteria
      meta.dev_hints = devHints
      await db.run(`UPDATE tasks SET metadata=?, updated_at=? WHERE id=?`, [
        JSON.stringify(meta),
        new Date().toISOString(),
        taskId,
      ])
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleRemote('task-vault:vault:reopen-task', RestoreTaskRequestSchema, async (args) => {
    if (!(await reopenTask(db, args.taskId, null))) return { error: 'STALE_ID' }
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:block-task', BlockTaskRequestSchema, async (args) => {
    const { taskId, reason, checkInterval } = args
    const now = new Date().toISOString()
    const meta = await taskMetadata(db, taskId)
    if (!meta) return { error: 'STALE_ID' }
    meta.blocked_reason = reason
    meta.blocked_check_interval = checkInterval
    await db.run(
      `UPDATE tasks SET status='blocked', metadata=?, blocked_reason=?, blocked_check_interval=?, updated_at=? WHERE id=?`,
      [JSON.stringify(meta), reason, checkInterval, now, taskId]
    )
    triggerSchedulerTick()
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:unblock-task', UnblockTaskRequestSchema, async (args) => {
    const { taskId } = args
    const now = new Date().toISOString()
    const meta = await taskMetadata(db, taskId)
    if (!meta) return { error: 'STALE_ID' }
    delete meta.blocked_reason
    delete meta.blocked_check_interval
    await db.run(
      `UPDATE tasks SET status='open', metadata=?, blocked_reason=NULL, blocked_check_interval=NULL, updated_at=? WHERE id=?`,
      [JSON.stringify(meta), now, taskId]
    )
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:set-recurrence', SetRecurrenceRequestSchema, async (args) => {
    const { taskId, interval, days, time, endType, endDate, endCount } = args
    const task = await db.get<{
      metadata: string
      due_date: string | null
      source_ref: string | null
    }>(`SELECT metadata, due_date, source_ref FROM tasks WHERE id=?`, [taskId])
    if (!task) return { error: 'STALE_ID' }

    let recurrenceRule: string = interval
    if (interval === 'weekly' && days != null && days.length > 0) {
      recurrenceRule = `weekly:${[...days].sort((a, b) => a - b).join(',')}`
    }

    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(task.metadata || '{}') as Record<string, unknown>
    } catch {
      // ignore
    }
    meta.recurrence_end_type = endType ?? 'none'
    meta.recurrence_end_date = endType === 'on_date' ? endDate : undefined
    meta.recurrence_end_count = endType === 'after_count' ? endCount : undefined
    meta.recurrence_completed_count = 0
    delete meta.recurrence_interval
    delete meta.recurrence_days
    delete meta.recurrence_time
    delete meta.recurrence_next_spawned
    delete meta.notification_notified_date

    const now = new Date().toISOString()
    const effectiveDueDate = task.due_date ?? task.source_ref ?? today()

    try {
      let nextTaskId: string | null = null
      await db.transaction(async (tx) => {
        await tx.run(
          `DELETE FROM tasks WHERE recurrence_template_id=? AND status='open' AND due_date > ?`,
          [taskId, today()]
        )
        await tx.run(
          `UPDATE tasks SET recurrence_rule=?, recurrence_notify_at=?, due_date=?, metadata=?,
            recurrence_end_type=?, recurrence_end_date=?, recurrence_end_count=?,
            recurrence_completed_count=0,
            updated_at=? WHERE id=?`,
          [
            recurrenceRule,
            time ?? null,
            effectiveDueDate,
            JSON.stringify(meta),
            endType ?? 'none',
            endType === 'on_date' ? (endDate ?? null) : null,
            endType === 'after_count' ? (endCount ?? null) : null,
            now,
            taskId,
          ]
        )
        nextTaskId = await ensureNextOccurrence(tx, taskId)
      })

      if (nextTaskId) {
        broadcast('task-vault:recurrence-spawned', { taskId, nextTaskId })
      }
      broadcast('task-vault:push:index-updated', {})
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { error: msg }
    }
  })

  handleRemote('task-vault:vault:clear-recurrence', ClearRecurrenceRequestSchema, async (args) => {
    const { taskId } = args
    const task = await db.get<{ metadata: string }>(`SELECT metadata FROM tasks WHERE id=?`, [
      taskId,
    ])
    if (!task) return { error: 'STALE_ID' }
    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(task.metadata || '{}') as Record<string, unknown>
    } catch {
      // ignore
    }
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
    await db.transaction(async (tx) => {
      await tx.run(`DELETE FROM tasks WHERE recurrence_template_id=? AND status='open'`, [taskId])
      await tx.run(
        `UPDATE tasks SET recurrence_rule=NULL, recurrence_notify_at=NULL,
          recurrence_end_type=NULL, recurrence_end_date=NULL, recurrence_end_count=NULL,
          recurrence_completed_count=NULL, metadata=?, updated_at=? WHERE id=?`,
        [JSON.stringify(meta), now, taskId]
      )
    })
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:reorder-tasks', ReorderTasksRequestSchema, async (args) => {
    const { orderedIds } = args
    const now = new Date().toISOString()
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.run(`UPDATE tasks SET sort_order=?, updated_at=? WHERE id=?`, [
          i,
          now,
          orderedIds[i],
        ])
      }
    })
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handleRemote('task-vault:vault:get-calendar-month', CalendarMonthRequestSchema, async (args) => {
    const { year, month } = args
    const pad = (n: number) => String(n).padStart(2, '0')
    const startDate = `${year}-${pad(month)}-01`
    const endDate = `${year}-${pad(month)}-31`
    type DayRow = { date: string; status: string; count: string }
    const rows = await db.query<DayRow>(
      `SELECT source_ref AS date, status, COUNT(*) AS count
       FROM tasks
       WHERE source='daily' AND source_ref >= ? AND source_ref <= ?
         AND parent_id IS NULL
       GROUP BY source_ref, status`,
      [startDate, endDate]
    )
    return { days: rows.map((r) => ({ ...r, count: Number(r.count) })) }
  })

  handleRemote('task-vault:vault:reset-today-since', CompleteTaskRequestSchema, async (args) => {
    const { taskId } = args
    const now = new Date().toISOString()
    await db.run(`UPDATE tasks SET today_since=?, updated_at=? WHERE id=?`, [today(), now, taskId])
    return { success: true }
  })

  handleRemote(
    'task-vault:settings:set-stale-threshold',
    StaleThresholdRequestSchema,
    async (args) => {
      const { days } = args
      await db.run(
        `INSERT INTO settings (extension_id, key, value) VALUES ('task-vault', 'stale_days_threshold', ?) ON CONFLICT (extension_id, key) DO UPDATE SET value = excluded.value`,
        [String(days)]
      )
      return { success: true }
    }
  )

  return cleanup
}
