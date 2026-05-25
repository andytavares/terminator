import { ipcMain } from 'electron'
import { getDb, randomUUID } from '../vault/db'
import {
  ListProjectsRequestSchema,
  UpdateProjectStatusRequestSchema,
  CreateProjectRequestSchema,
  DeleteProjectRequestSchema,
} from '../schemas/vault.schema'
import type { IndexedProject, IndexedTask, ProjectStatus, TaskStatus } from '../vault/types'

// vaultPath kept for API compatibility with activate()
let vaultPath = ''

export function setVaultPath(p: string) {
  vaultPath = p
}

// Suppress unused warning
export function getVaultPath(): string {
  return vaultPath
}

function rowToTask(row: Record<string, unknown>): IndexedTask {
  const source = row.source as string
  const sourceRef = row.source_ref as string | null
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

const PROJECT_COLS = `p.id, p.name, p.status, ar.name AS area, p.deadline, p.outcome, p.terminator_links, p.created_at, p.updated_at`
const PROJECT_JOINS = `LEFT JOIN areas ar ON p.area_id = ar.id`

function rowToProject(row: Record<string, unknown>): IndexedProject {
  return {
    id: row.id as string,
    filePath: row.name as string,
    name: row.name as string,
    status: row.status as ProjectStatus,
    area: (row.area as string) || undefined,
    deadline: (row.deadline as string) || undefined,
    isStale: false,
    nextActionCount: 0,
    lastModified: row.updated_at as string,
    terminatorLinks: JSON.parse((row.terminator_links as string) || '[]'),
  }
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
      completedLastWeek,
      lastReviewDate: null,
    }
  })

  // ── projects:create ──────────────────────────────────────────────────────────

  handle('task-vault:projects:create', async (_event, payload) => {
    const parsed = CreateProjectRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { name, area, deadline, outcome } = parsed.data
    const db = getDb()
    const existing = db.prepare(`SELECT id FROM projects WHERE name=?`).get(name)
    if (existing) return { error: 'PROJECT_EXISTS' }
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
        db.prepare(`INSERT OR IGNORE INTO areas (id,name,created_at) VALUES (?,?,?)`).run(
          areaId,
          area,
          now
        )
      }
    }
    db.prepare(
      `INSERT INTO projects (id,name,status,area_id,deadline,outcome,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(randomUUID(), name, 'active', areaId, deadline ?? null, outcome ?? null, now, now)
    return { success: true, filePath: name }
  })

  // ── projects:delete ──────────────────────────────────────────────────────────

  handle('task-vault:projects:delete', async (_event, payload) => {
    const parsed = DeleteProjectRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    // projectFilePath is now the project name
    const { projectFilePath: projectName } = parsed.data
    const db = getDb()
    // FK ON DELETE SET NULL handles tasks.project_id automatically
    db.prepare(`DELETE FROM projects WHERE name=?`).run(projectName)
    return { success: true }
  })

  // ── vault:update-project-status (duplicate handler in projects module) ───────

  handle('task-vault:projects:update-status', async (_event, payload) => {
    const parsed = UpdateProjectStatusRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { projectFilePath: projectName, status } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
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
        db.prepare(`INSERT OR IGNORE INTO areas (id,name,created_at) VALUES (?,?,?)`).run(
          areaId,
          area,
          now
        )
      }
    }
    db.prepare(`UPDATE projects SET area_id=?, updated_at=? WHERE name=?`).run(
      areaId,
      now,
      projectName
    )
    return { success: true }
  })

  return () => {
    for (const channel of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
