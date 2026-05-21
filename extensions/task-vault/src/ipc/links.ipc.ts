import { ipcMain } from 'electron'
import { getDb } from '../vault/db'
import {
  LinksCreateRequestSchema,
  LinksRemoveRequestSchema,
  LinksGetForTargetRequestSchema,
} from '../schemas/vault.schema'
import type { IndexedTask, IndexedProject, TaskStatus, ProjectStatus } from '../vault/types'

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

export function registerLinksIpcHandlers(): () => void {
  const channels: string[] = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, fn)
    channels.push(channel)
  }

  // ── links:create ─────────────────────────────────────────────────────────────

  handle('task-vault:links:create', async (_event, payload) => {
    const parsed = LinksCreateRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, projectFilePath, targetId } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    try {
      if (taskId) {
        const task = db
          .prepare(`SELECT terminator_links FROM tasks WHERE id=?`)
          .get(taskId) as { terminator_links: string } | undefined
        if (!task) return { error: 'NOT_FOUND' }
        const links: string[] = JSON.parse(task.terminator_links || '[]')
        if (!links.includes(targetId)) links.push(targetId)
        db.prepare(`UPDATE tasks SET terminator_links=?, updated_at=? WHERE id=?`).run(
          JSON.stringify(links), now, taskId
        )
      } else if (projectFilePath) {
        // projectFilePath is now the project name
        const project = db
          .prepare(`SELECT terminator_links FROM projects WHERE name=?`)
          .get(projectFilePath) as { terminator_links: string } | undefined
        if (!project) return { error: 'NOT_FOUND' }
        const links: string[] = JSON.parse(project.terminator_links || '[]')
        if (!links.includes(targetId)) links.push(targetId)
        db.prepare(`UPDATE projects SET terminator_links=?, updated_at=? WHERE name=?`).run(
          JSON.stringify(links), now, projectFilePath
        )
      }
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── links:remove ─────────────────────────────────────────────────────────────

  handle('task-vault:links:remove', async (_event, payload) => {
    const parsed = LinksRemoveRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, projectFilePath, targetId } = parsed.data
    const db = getDb()
    const now = new Date().toISOString()
    try {
      if (taskId) {
        const task = db
          .prepare(`SELECT terminator_links FROM tasks WHERE id=?`)
          .get(taskId) as { terminator_links: string } | undefined
        if (!task) return { error: 'NOT_FOUND' }
        const links: string[] = JSON.parse(task.terminator_links || '[]').filter(
          (l: string) => l !== targetId
        )
        db.prepare(`UPDATE tasks SET terminator_links=?, updated_at=? WHERE id=?`).run(
          JSON.stringify(links), now, taskId
        )
      } else if (projectFilePath) {
        const project = db
          .prepare(`SELECT terminator_links FROM projects WHERE name=?`)
          .get(projectFilePath) as { terminator_links: string } | undefined
        if (!project) return { error: 'NOT_FOUND' }
        const links: string[] = JSON.parse(project.terminator_links || '[]').filter(
          (l: string) => l !== targetId
        )
        db.prepare(`UPDATE projects SET terminator_links=?, updated_at=? WHERE name=?`).run(
          JSON.stringify(links), now, projectFilePath
        )
      }
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── links:get-for-terminator-target ──────────────────────────────────────────

  handle('task-vault:links:get-for-terminator-target', async (_event, payload) => {
    const parsed = LinksGetForTargetRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { targetId } = parsed.data
    const db = getDb()
    // SQLite doesn't have native JSON array search — use LIKE for UUID substring
    const escapedId = targetId.replace(/[%_]/g, '\\$&')
    const taskRows = db
      .prepare(`SELECT * FROM tasks WHERE terminator_links LIKE ? ESCAPE '\\'`)
      .all(`%${escapedId}%`) as Record<string, unknown>[]
    const tasks = taskRows
      .map(rowToTask)
      .filter((t) => t.terminatorLinks.includes(targetId))

    const projectRows = db
      .prepare(`SELECT * FROM projects WHERE terminator_links LIKE ? ESCAPE '\\'`)
      .all(`%${escapedId}%`) as Record<string, unknown>[]
    const projects = projectRows
      .map(rowToProject)
      .filter((p) => p.terminatorLinks.includes(targetId))

    return { tasks, projects }
  })

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel)
    }
  }
}
