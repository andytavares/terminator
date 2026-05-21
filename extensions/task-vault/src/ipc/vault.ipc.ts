import * as path from 'node:path'
import { ipcMain } from 'electron'
import { getDb, randomUUID } from '../vault/db'
import { extractTags } from '../vault/tags'
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
} from '../schemas/vault.schema'
import type { IndexedTask, IndexedProject, TaskStatus, ProjectStatus } from '../vault/types'

// vaultPath is kept so ICS handler can still use it (unchanged)
let vaultPath = ''

export function setVaultPath(p: string) {
  vaultPath = p
}

// Suppress unused warning — vaultPath is a public export contract
export function getVaultPath(): string {
  return vaultPath
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function rowToTask(row: Record<string, unknown>): IndexedTask {
  const source = row.source as string
  const sourceRef = row.source_ref as string | null
  // Build a virtual filePath for display purposes (archive view)
  const filePath = sourceRef ? `${source}/${sourceRef}` : source
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

function ensureProjectAndArea(
  db: ReturnType<typeof getDb>,
  project: string | undefined,
  area: string | undefined,
  now: string
): void {
  if (area) {
    db.prepare(`INSERT OR IGNORE INTO areas (id,name,created_at) VALUES (?,?,?)`).run(
      randomUUID(), area, now
    )
  }
  if (project) {
    db.prepare(
      `INSERT OR IGNORE INTO projects (id,name,status,area,created_at,updated_at) VALUES (?,?,?,?,?,?)`
    ).run(randomUUID(), project, 'active', area ?? null, now, now)
  }
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
    ensureProjectAndArea(db, extracted.project, extracted.area, now)
    db.prepare(
      `INSERT INTO tasks (id,text,status,project,context,area,due_date,source,source_ref,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      extracted.text,
      'open',
      extracted.project ?? null,
      extracted.context ?? null,
      extracted.area ?? null,
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
      const taskRows = db
        .prepare(
          `SELECT * FROM tasks WHERE source='daily' AND source_ref=? AND parent_id IS NULL ORDER BY sort_order, created_at`
        )
        .all(date) as Record<string, unknown>[]
      const tasks = taskRows.map(rowToTask)
      for (const task of tasks) {
        task.subtasks = (
          db
            .prepare(
              `SELECT * FROM tasks WHERE parent_id=? ORDER BY sort_order, created_at`
            )
            .all(task.id) as Record<string, unknown>[]
        ).map(rowToTask)
      }
      const events = db.prepare(`SELECT * FROM events WHERE date=? ORDER BY time`).all(date)
      const notes = db.prepare(`SELECT * FROM notes WHERE date=? ORDER BY rowid`).all(date)
      return {
        date,
        filePath: `daily/${date}.md`,
        tasks,
        events,
        notes,
        exists: tasks.length > 0 || (events as unknown[]).length > 0 || (notes as unknown[]).length > 0,
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
          `SELECT * FROM tasks WHERE source='daily' AND source_ref=? AND parent_id IS NULL ORDER BY sort_order, created_at`
        )
        .all(date) as Record<string, unknown>[]
      const tasks = taskRows.map(rowToTask)
      for (const task of tasks) {
        task.subtasks = (
          db
            .prepare(`SELECT * FROM tasks WHERE parent_id=? ORDER BY sort_order, created_at`)
            .all(task.id) as Record<string, unknown>[]
        ).map(rowToTask)
      }
      const events = db.prepare(`SELECT * FROM events WHERE date=? ORDER BY time`).all(date)
      const notes = db.prepare(`SELECT * FROM notes WHERE date=? ORDER BY rowid`).all(date)
      return {
        date,
        filePath: `daily/${date}.md`,
        tasks,
        events,
        notes,
        exists: tasks.length > 0 || (events as unknown[]).length > 0 || (notes as unknown[]).length > 0,
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
    ensureProjectAndArea(db, extracted.project, extracted.area, now)
    db.prepare(
      `INSERT INTO tasks (id,text,status,project,context,area,due_date,source,source_ref,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      extracted.text,
      'open',
      extracted.project ?? null,
      extracted.context ?? null,
      extracted.area ?? null,
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
    const changes = db
      .prepare(`UPDATE tasks SET status='done', completed_date=?, updated_at=? WHERE id=?`)
      .run(today(), now, taskId)
    if (changes.changes === 0) return { error: 'STALE_ID' }
    return { success: true }
  })

  // ── vault:migrate-task ───────────────────────────────────────────────────────

  handle('task-vault:vault:migrate-task', async (_event, payload) => {
    const parsed = MigrateTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, targetDate } = parsed.data
    const db = getDb()
    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(taskId) as Record<string, unknown> | undefined
    if (!task) return { error: 'STALE_ID' }
    const now = new Date().toISOString()
    db.prepare(`UPDATE tasks SET status='migrated', migrated_to=?, updated_at=? WHERE id=?`).run(
      targetDate,
      now,
      taskId
    )
    // Create new task on target date
    const newId = randomUUID()
    db.prepare(
      `INSERT INTO tasks (id,text,status,project,context,area,due_date,source,source_ref,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId,
      task.text,
      'open',
      task.project ?? null,
      task.context ?? null,
      task.area ?? null,
      task.due_date ?? null,
      'daily',
      targetDate,
      now,
      now
    )
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
      conditions.push(`status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    }
    if (context) { conditions.push(`context=?`); params.push(context) }
    if (project) { conditions.push(`project=?`); params.push(project) }
    if (area) { conditions.push(`area=?`); params.push(area) }
    if (dueBefore) { conditions.push(`due_date < ?`); params.push(dueBefore) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at`).all(...params) as Record<string, unknown>[]
    return { tasks: rows.map(rowToTask) }
  })

  // ── vault:process-inbox-item ─────────────────────────────────────────────────

  handle('task-vault:vault:process-inbox-item', async (_event, payload) => {
    const parsed = ProcessInboxRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, action, destination, newProjectName } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()

    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(taskId) as Record<string, unknown> | undefined
    if (!task) return { error: 'STALE_ID' }

    if (action === 'trash') {
      db.prepare(`DELETE FROM tasks WHERE id=? OR parent_id=?`).run(taskId, taskId)
      return { success: true }
    }

    if (action === 'do-now') {
      db.prepare(`UPDATE tasks SET status='in-progress', updated_at=? WHERE id=?`).run(now, taskId)
      return { success: true }
    }

    if (action === 'someday') {
      db.prepare(`UPDATE tasks SET source='someday', source_ref=NULL, updated_at=? WHERE id=?`).run(now, taskId)
      // Move subtasks too
      db.prepare(`UPDATE tasks SET source='someday', source_ref=NULL, updated_at=? WHERE parent_id=?`).run(now, taskId)
      return { success: true }
    }

    // action === 'file'
    let source = 'inbox'
    let sourceRef: string | null = null

    if (newProjectName) {
      source = 'project'
      sourceRef = newProjectName
      // Ensure project exists
      const existing = db.prepare(`SELECT id FROM projects WHERE name=?`).get(newProjectName)
      if (!existing) {
        db.prepare(
          `INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)`
        ).run(randomUUID(), newProjectName, 'active', now, now)
      }
    } else if (destination) {
      const resolved = resolveSource(destination)
      source = resolved.source
      sourceRef = resolved.sourceRef
    } else {
      return { error: 'destination required for action: file' }
    }

    db.prepare(`UPDATE tasks SET source=?, source_ref=?, updated_at=? WHERE id=?`).run(
      source, sourceRef, now, taskId
    )
    db.prepare(`UPDATE tasks SET source=?, source_ref=?, updated_at=? WHERE parent_id=?`).run(
      source, sourceRef, now, taskId
    )

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
    ensureProjectAndArea(db, extracted.project, extracted.area, now)
    const changes = db
      .prepare(
        `UPDATE tasks SET text=?,project=?,context=?,area=?,due_date=?,updated_at=? WHERE id=?`
      )
      .run(
        extracted.text,
        extracted.project ?? null,
        extracted.context ?? null,
        extracted.area ?? null,
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
    const changes = db.prepare(`DELETE FROM tasks WHERE id=? OR parent_id=?`).run(taskId, taskId)
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
    const changes = db
      .prepare(
        `UPDATE tasks SET status='open', completed_date=NULL, migrated_to=NULL, updated_at=? WHERE id=?`
      )
      .run(now, taskId)
    if (changes.changes === 0) return { error: 'STALE_ID' }
    return { success: true }
  })

  // ── vault:create-area ────────────────────────────────────────────────────────

  handle('task-vault:vault:create-area', async (_event, payload) => {
    const parsed = CreateAreaRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { name } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    const existing = db.prepare(`SELECT id FROM areas WHERE name=?`).get(name.trim())
    if (existing) return { error: 'AREA_EXISTS' }
    db.prepare(`INSERT INTO areas (id,name,created_at) VALUES (?,?,?)`).run(
      randomUUID(), name.trim(), now
    )
    return { success: true, filePath: name.trim() }
  })

  // ── vault:delete-area ────────────────────────────────────────────────────────

  handle('task-vault:vault:delete-area', async (_event, payload) => {
    const parsed = DeleteAreaRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { areaFilePath } = parsed.data
    // Extract area name from path (basename without .md)
    const areaName = path.basename(areaFilePath, '.md')
    const db = getDb()
    db.prepare(`DELETE FROM areas WHERE name=?`).run(areaName)
    // Orphan tasks tagged with this area (don't delete them — just untag)
    db.prepare(`UPDATE tasks SET area=NULL WHERE area=?`).run(areaName)
    return { success: true }
  })

  // ── vault:get-inbox ──────────────────────────────────────────────────────────

  handle('task-vault:vault:get-inbox', async () => {
    try {
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT * FROM tasks WHERE source='inbox' AND status='open' AND parent_id IS NULL ORDER BY created_at`
        )
        .all() as Record<string, unknown>[]
      const tasks = rows.map(rowToTask)
      for (const task of tasks) {
        task.subtasks = (
          db
            .prepare(`SELECT * FROM tasks WHERE parent_id=? ORDER BY sort_order, created_at`)
            .all(task.id) as Record<string, unknown>[]
        ).map(rowToTask)
      }
      return { tasks }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── vault:list-areas ─────────────────────────────────────────────────────────

  handle('task-vault:vault:list-areas', async () => {
    try {
      const db = getDb()
      const areaRows = db.prepare(`SELECT * FROM areas ORDER BY name`).all() as Record<string, unknown>[]
      const result: unknown[] = []

      for (const a of areaRows) {
        const areaName = a.name as string
        const taskRows = db
          .prepare(
            `SELECT * FROM tasks WHERE area=? AND parent_id IS NULL AND status != 'done' ORDER BY created_at`
          )
          .all(areaName) as Record<string, unknown>[]
        const tasks = taskRows.map(rowToTask)
        const projectRows = db
          .prepare(`SELECT * FROM projects WHERE area=? ORDER BY name`)
          .all(areaName) as Record<string, unknown>[]
        const projects = projectRows.map((p) => {
          const nextActionCount = (
            db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE project=? AND status='open'`).get(
              p.name
            ) as { c: number }
          ).c
          return { ...rowToProject(p), nextActionCount, isStale: nextActionCount === 0 }
        })
        result.push({
          filePath: areaName,
          name: areaName,
          taskCount: tasks.length,
          openTaskCount: tasks.filter((t) => t.status === 'open').length,
          tasks,
          projects,
        })
      }

      // Also include tasks tagged with areas not in the areas table
      const orphanRows = db
        .prepare(
          `SELECT DISTINCT area FROM tasks WHERE area IS NOT NULL AND area NOT IN (SELECT name FROM areas)`
        )
        .all() as { area: string }[]
      for (const { area } of orphanRows) {
        const taskRows = db
          .prepare(`SELECT * FROM tasks WHERE area=? AND parent_id IS NULL ORDER BY created_at`)
          .all(area) as Record<string, unknown>[]
        const tasks = taskRows.map(rowToTask)
        result.push({
          filePath: area,
          name: area,
          taskCount: tasks.length,
          openTaskCount: tasks.filter((t) => t.status === 'open').length,
          tasks,
          projects: [],
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
      .prepare(`SELECT * FROM tasks WHERE project=? ORDER BY status, created_at`)
      .all(projectName) as Record<string, unknown>[]
    return { tasks: rows.map(rowToTask) }
  })

  // ── vault:list-archive ───────────────────────────────────────────────────────

  handle('task-vault:vault:list-archive', async (_event, payload) => {
    const parsed = ListArchiveRequestSchema.safeParse(payload ?? {})
    const days = parsed.success ? (parsed.data.days ?? 30) : 30
    try {
      const db = getDb()
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
      const taskRows = db
        .prepare(
          `SELECT * FROM tasks WHERE status IN ('done','cancelled','migrated') AND updated_at >= ? ORDER BY updated_at DESC`
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

  // ── vault:update-project-status ──────────────────────────────────────────────

  handle('task-vault:vault:update-project-status', async (_event, payload) => {
    const parsed = UpdateProjectStatusRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    // projectFilePath is now treated as the project name (stable identifier)
    const { projectFilePath: projectName, status } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    // Try by name first, then by id for backwards compat
    let changes = db
      .prepare(`UPDATE projects SET status=?, updated_at=? WHERE name=?`)
      .run(status, now, projectName)
    if (changes.changes === 0) {
      changes = db
        .prepare(`UPDATE projects SET status=?, updated_at=? WHERE id=?`)
        .run(status, now, projectName)
    }
    if (changes.changes === 0) return { error: 'NOT_FOUND' }
    return { success: true }
  })

  return () => {
    for (const [channel] of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
