import { ipcMain } from 'electron'
import { getDb, randomUUID } from '../vault/db'
import { toDisplayName } from '../vault/tags'
import { broadcast } from '../notifications/task-scheduler.js'
import {
  ListProjectsRequestSchema,
  UpdateProjectStatusRequestSchema,
  CreateProjectRequestSchema,
  DeleteProjectRequestSchema,
} from '../schemas/vault.schema'
import type { ProjectStatus } from '../vault/types'
import { setVaultPath as _setVaultPath, getVaultPath as _getVaultPath } from '../vault/vault-path'
import { rowToTask, rowToProject, PROJECT_COLS, PROJECT_JOINS } from '../vault/mappers'

export function setVaultPath(p: string): void {
  _setVaultPath(p)
}

export function getVaultPath(): string {
  return _getVaultPath()
}

export function registerProjectsIpcHandlers(): () => void {
  const handlers: string[] = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, fn)
    handlers.push(channel)
  }

  // ── projects:list ────────────────────────────────────────────────────────────

  handle('task-vault:projects:list', async (_event, payload) => {
    const parsed = ListProjectsRequestSchema.safeParse(payload ?? {})
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }

    const statusFilter: ProjectStatus[] = parsed.data.status
      ? Array.isArray(parsed.data.status)
        ? (parsed.data.status as ProjectStatus[])
        : [parsed.data.status as ProjectStatus]
      : ['active']

    const db = getDb()
    const placeholders = statusFilter.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status IN (${placeholders}) ORDER BY p.name`
      )
      .all(...statusFilter) as Record<string, unknown>[]

    const projects = rows.map((p) => {
      const nextActionCount = (
        db
          .prepare(`SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status='open'`)
          .get(p.id) as { c: number }
      ).c
      const isStale = nextActionCount === 0
      return { ...rowToProject(p), nextActionCount, isStale }
    })

    return { projects }
  })

  // ── projects:weekly-review ───────────────────────────────────────────────────

  handle('task-vault:projects:weekly-review', async () => {
    const db = getDb()
    const inboxRows = db
      .prepare(`SELECT * FROM tasks WHERE source='inbox' AND status='open'`)
      .all() as Record<string, unknown>[]
    const inboxItems = inboxRows.map(rowToTask)

    const activeRows = db
      .prepare(`SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status='active'`)
      .all() as Record<string, unknown>[]
    const activeProjects = activeRows.map((p) => {
      const nextActionCount = (
        db
          .prepare(`SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status='open'`)
          .get(p.id) as { c: number }
      ).c
      return { ...rowToProject(p), nextActionCount, isStale: nextActionCount === 0 }
    })
    const staleProjects = activeProjects.filter((p) => p.isStale)

    const somedayRows = db
      .prepare(`SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status='someday'`)
      .all() as Record<string, unknown>[]
    const somedayProjects = somedayRows.map(rowToProject)

    const somedayTaskRows = db
      .prepare(
        `SELECT * FROM tasks WHERE source='someday' AND status='open' AND parent_id IS NULL ORDER BY created_at ASC`
      )
      .all() as Record<string, unknown>[]
    const somedayTasks = somedayTaskRows.map(rowToTask)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const completedRows = db
      .prepare(`SELECT * FROM tasks WHERE status='done' AND updated_at >= ?`)
      .all(sevenDaysAgo) as Record<string, unknown>[]
    const completedLastWeek = completedRows.map(rowToTask)

    return {
      inboxItems,
      activeProjects,
      staleProjects,
      somedayProjects,
      somedayTasks,
      completedLastWeek,
      lastReviewDate: null,
    }
  })

  // ── projects:create ──────────────────────────────────────────────────────────

  handle('task-vault:projects:create', async (_event, payload) => {
    const parsed = CreateProjectRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { name, area, deadline, outcome } = parsed.data
    const displayName = toDisplayName(name.trim())
    const displayArea = area ? toDisplayName(area.trim()) : undefined
    const db = getDb()
    const existing = db.prepare(`SELECT id FROM projects WHERE name=?`).get(displayName)
    if (existing) return { error: 'PROJECT_EXISTS' }
    const now = new Date().toISOString()
    let areaId: string | null = null
    if (displayArea) {
      const existingArea = db.prepare(`SELECT id FROM areas WHERE name=?`).get(displayArea) as
        | { id: string }
        | undefined
      if (existingArea) {
        areaId = existingArea.id
      } else {
        areaId = randomUUID()
        db.prepare(
          `INSERT OR IGNORE INTO areas (id,name,created_at,updated_at) VALUES (?,?,?,?)`
        ).run(areaId, displayArea, now, now)
      }
    }
    db.prepare(
      `INSERT INTO projects (id,name,status,area_id,deadline,outcome,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(randomUUID(), displayName, 'active', areaId, deadline ?? null, outcome ?? null, now, now)
    broadcast('task-vault:push:index-updated', {})
    return { success: true, filePath: displayName }
  })

  // ── projects:delete ──────────────────────────────────────────────────────────

  handle('task-vault:projects:delete', async (_event, payload) => {
    const parsed = DeleteProjectRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { projectFilePath: projectName } = parsed.data
    const db = getDb()

    const proj = db.prepare(`SELECT id, status FROM projects WHERE name=?`).get(projectName) as
      | { id: string; status: string }
      | undefined
    if (!proj) return { error: 'NOT_FOUND' }
    if (proj.status !== 'archived') return { error: 'MUST_ARCHIVE_FIRST' }

    // Delete all tasks (subtasks cascade via parent_id FK)
    db.prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM tasks WHERE project_id=? AND parent_id IS NULL
         UNION ALL
         SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
       )
       DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)`
    ).run(proj.id)
    // Also catch any orphaned tasks remaining
    db.prepare(`DELETE FROM tasks WHERE project_id=?`).run(proj.id)
    db.prepare(`DELETE FROM projects WHERE id=?`).run(proj.id)
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  // ── vault:update-project-status (duplicate handler in projects module) ───────

  handle('task-vault:projects:update-status', async (_event, payload) => {
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
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  // ── projects:update-area ─────────────────────────────────────────────────────

  handle('task-vault:projects:update-area', async (_event, payload) => {
    const { projectFilePath: projectName, area } = payload as {
      projectFilePath: string
      area: string | null
    }
    if (!projectName) return { error: 'VALIDATION_ERROR' }
    const db = getDb()
    const now = new Date().toISOString()
    let areaId: string | null = null
    if (area) {
      const existingArea = db.prepare(`SELECT id FROM areas WHERE name=?`).get(area) as
        | { id: string }
        | undefined
      if (existingArea) {
        areaId = existingArea.id
      } else {
        areaId = randomUUID()
        db.prepare(
          `INSERT OR IGNORE INTO areas (id,name,created_at,updated_at) VALUES (?,?,?,?)`
        ).run(areaId, area, now, now)
      }
    }
    db.prepare(`UPDATE projects SET area_id=?, updated_at=? WHERE name=?`).run(
      areaId,
      now,
      projectName
    )
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  // ── projects:update-deadline ─────────────────────────────────────────────────

  handle('task-vault:projects:update-deadline', async (_event, payload) => {
    const { projectFilePath: projectName, deadline } = payload as {
      projectFilePath: string
      deadline: string | null
    }
    if (!projectName) return { error: 'VALIDATION_ERROR' }
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`UPDATE projects SET deadline=?, updated_at=? WHERE name=?`).run(
      deadline || null,
      now,
      projectName
    )
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  // ── projects:rename ──────────────────────────────────────────────────────────

  handle('task-vault:projects:rename', async (_event, payload) => {
    const { projectFilePath: projectName, newName } = payload as {
      projectFilePath: string
      newName: string
    }
    if (!projectName || !newName?.trim()) return { error: 'VALIDATION_ERROR' }
    const db = getDb()
    const now = new Date().toISOString()
    const proj = db.prepare(`SELECT id FROM projects WHERE name=?`).get(projectName) as
      | { id: string }
      | undefined
    if (!proj) return { error: 'NOT_FOUND' }
    const existing = db
      .prepare(`SELECT id FROM projects WHERE name=? AND id != ?`)
      .get(newName.trim(), proj.id)
    if (existing) return { error: 'PROJECT_EXISTS' }
    db.prepare(`UPDATE projects SET name=?, updated_at=? WHERE id=?`).run(
      newName.trim(),
      now,
      proj.id
    )
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  return () => {
    for (const channel of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
