import { ipcMain } from 'electron'
import type { ExtensionDB } from '../../../../src/main/extensions/api'
import { randomUUID } from '../vault/db'
import { toDisplayName } from '../vault/tags'
import { broadcast } from '../notifications/task-scheduler.js'
import {
  ListProjectsRequestSchema,
  UpdateProjectStatusRequestSchema,
  CreateProjectRequestSchema,
  DeleteProjectRequestSchema,
} from '../schemas/vault.schema'
import type { ProjectStatus } from '../vault/types'
import {
  rowToTask,
  rowToProject,
  PROJECT_COLS,
  PROJECT_JOINS,
  TASK_COLS,
  TASK_JOINS,
} from '../vault/mappers'

export function registerProjectsIpcHandlers(db: ExtensionDB): () => void {
  const handlers: string[] = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return await fn(event, payload)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })
    handlers.push(channel)
  }

  handle('task-vault:projects:list', async (_event, payload) => {
    const parsed = ListProjectsRequestSchema.safeParse(payload ?? {})
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }

    const statusFilter: ProjectStatus[] = parsed.data.status
      ? Array.isArray(parsed.data.status)
        ? (parsed.data.status as ProjectStatus[])
        : [parsed.data.status as ProjectStatus]
      : ['active']

    const placeholders = statusFilter.map(() => '?').join(',')
    const rows = await db.query<Record<string, unknown>>(
      `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status IN (${placeholders}) ORDER BY p.name`,
      statusFilter
    )

    const projects = await Promise.all(
      rows.map(async (p) => {
        const ncRow = await db.get<{ c: string }>(
          `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status='open'`,
          [p.id as string]
        )
        const nextActionCount = Number(ncRow?.c ?? 0)
        const isStale = nextActionCount === 0
        return { ...rowToProject(p), nextActionCount, isStale }
      })
    )

    return { projects }
  })

  handle('task-vault:projects:weekly-review', async () => {
    const inboxRows = await db.query<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE source='inbox' AND status='open'`
    )
    const inboxItems = inboxRows.map(rowToTask)

    const activeRows = await db.query<Record<string, unknown>>(
      `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status='active'`
    )
    const activeProjects = await Promise.all(
      activeRows.map(async (p) => {
        const ncRow = await db.get<{ c: string }>(
          `SELECT COUNT(*) as c FROM tasks WHERE project_id=? AND status='open'`,
          [p.id as string]
        )
        const nextActionCount = Number(ncRow?.c ?? 0)
        return { ...rowToProject(p), nextActionCount, isStale: nextActionCount === 0 }
      })
    )
    const staleProjects = activeProjects.filter((p) => p.isStale)

    const somedayRows = await db.query<Record<string, unknown>>(
      `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status='someday'`
    )
    const somedayProjects = somedayRows.map(rowToProject)

    const somedayTaskRows = await db.query<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE source='someday' AND status='open' AND parent_id IS NULL ORDER BY created_at ASC`
    )
    const somedayTasks = somedayTaskRows.map(rowToTask)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const completedRows = await db.query<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE status='done' AND updated_at >= ?`,
      [sevenDaysAgo]
    )
    const completedLastWeek = completedRows.map(rowToTask)

    const thresholdRow = await db.get<{ value: string }>(
      `SELECT value FROM settings WHERE extension_id='task-vault' AND key='stale_days_threshold'`
    )
    const parsedThreshold = thresholdRow?.value ? parseInt(thresholdRow.value, 10) : NaN
    const staleDaysThreshold = Number.isFinite(parsedThreshold) ? parsedThreshold : 7
    const staleDate = new Date()
    staleDate.setDate(staleDate.getDate() - staleDaysThreshold)
    const staleDateStr = [
      staleDate.getFullYear(),
      String(staleDate.getMonth() + 1).padStart(2, '0'),
      String(staleDate.getDate()).padStart(2, '0'),
    ].join('-')
    const staleTaskRows = await db.query<Record<string, unknown>>(
      `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
       WHERE t.source='daily' AND t.parent_id IS NULL
         AND t.status IN ('open','in-progress','blocked')
         AND t.today_since IS NOT NULL AND t.today_since <= ?`,
      [staleDateStr]
    )
    const staleTasks = staleTaskRows.map(rowToTask)

    return {
      inboxItems,
      activeProjects,
      staleProjects,
      somedayProjects,
      somedayTasks,
      completedLastWeek,
      staleTasks,
      staleDaysThreshold,
      lastReviewDate: null,
    }
  })

  handle('task-vault:projects:create', async (_event, payload) => {
    const parsed = CreateProjectRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { name, area, deadline, outcome } = parsed.data
    const displayName = toDisplayName(name.trim())
    const displayArea = area ? toDisplayName(area.trim()) : undefined
    const existing = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [
      displayName,
    ])
    if (existing) return { error: 'PROJECT_EXISTS' }
    const now = new Date().toISOString()
    let areaId: string | null = null
    if (displayArea) {
      const existingArea = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [
        displayArea,
      ])
      if (existingArea) {
        areaId = existingArea.id
      } else {
        areaId = randomUUID()
        await db.run(
          `INSERT INTO areas (id,name,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,
          [areaId, displayArea, now, now]
        )
      }
    }
    await db.run(
      `INSERT INTO projects (id,name,status,area_id,deadline,outcome,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(), displayName, 'active', areaId, deadline ?? null, outcome ?? null, now, now]
    )
    broadcast('task-vault:push:index-updated', {})
    return { success: true, filePath: displayName }
  })

  handle('task-vault:projects:delete', async (_event, payload) => {
    const parsed = DeleteProjectRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { projectFilePath: projectName } = parsed.data

    const proj = await db.get<{ id: string; status: string }>(
      `SELECT id, status FROM projects WHERE name=?`,
      [projectName]
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
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handle('task-vault:projects:update-status', async (_event, payload) => {
    const parsed = UpdateProjectStatusRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { projectFilePath: projectName, status } = parsed.data
    const now = new Date().toISOString()

    let proj = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [projectName])
    if (!proj) {
      proj = await db.get<{ id: string }>(`SELECT id FROM projects WHERE id=?`, [projectName])
    }
    if (!proj) return { error: 'NOT_FOUND' }

    if (status === 'archived') {
      await db.run(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM tasks WHERE project_id=? AND parent_id IS NULL
           UNION ALL
           SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
         )
         UPDATE tasks SET status='cancelled', updated_at=?
         WHERE id IN (SELECT id FROM subtree)
           AND status IN ('open','in-progress','in-review','blocked')`,
        [proj.id, now]
      )
    }

    await db.run(`UPDATE projects SET status=?, updated_at=? WHERE id=?`, [status, now, proj.id])
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handle('task-vault:projects:update-area', async (_event, payload) => {
    const { projectFilePath: projectName, area } = payload as {
      projectFilePath: string
      area: string | null
    }
    if (!projectName) return { error: 'VALIDATION_ERROR' }
    const now = new Date().toISOString()
    let areaId: string | null = null
    if (area) {
      const existingArea = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [area])
      if (existingArea) {
        areaId = existingArea.id
      } else {
        areaId = randomUUID()
        await db.run(
          `INSERT INTO areas (id,name,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,
          [areaId, area, now, now]
        )
      }
    }
    await db.run(`UPDATE projects SET area_id=?, updated_at=? WHERE name=?`, [
      areaId,
      now,
      projectName,
    ])
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handle('task-vault:projects:update-deadline', async (_event, payload) => {
    const { projectFilePath: projectName, deadline } = payload as {
      projectFilePath: string
      deadline: string | null
    }
    if (!projectName) return { error: 'VALIDATION_ERROR' }
    const now = new Date().toISOString()
    await db.run(`UPDATE projects SET deadline=?, updated_at=? WHERE name=?`, [
      deadline || null,
      now,
      projectName,
    ])
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  handle('task-vault:projects:rename', async (_event, payload) => {
    const { projectFilePath: projectName, newName } = payload as {
      projectFilePath: string
      newName: string
    }
    if (!projectName || !newName?.trim()) return { error: 'VALIDATION_ERROR' }
    const now = new Date().toISOString()
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
    broadcast('task-vault:push:index-updated', {})
    return { success: true }
  })

  return () => {
    for (const channel of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
