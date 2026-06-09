import { ipcMain } from 'electron'
import { z } from 'zod'
import { getDb } from '../vault/db'
import type { KanbanConfig, TaskStatus } from '../vault/types'
import { DEFAULT_KANBAN_CONFIG } from '../vault/types'
import { setVaultPath as _setVaultPath } from '../vault/vault-path'

export function setVaultPath(p: string): void {
  _setVaultPath(p)
}

function readConfig(): KanbanConfig {
  try {
    const db = getDb()
    const row = db.prepare(`SELECT value FROM settings WHERE key='kanban_config'`).get() as
      | { value: string }
      | undefined
    if (!row) return { ...DEFAULT_KANBAN_CONFIG }
    return JSON.parse(row.value) as KanbanConfig
  } catch {
    return { ...DEFAULT_KANBAN_CONFIG }
  }
}

function writeConfig(config: KanbanConfig): void {
  const db = getDb()
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('kanban_config', ?)`).run(
    JSON.stringify(config)
  )
}

const MoveTaskSchema = z.object({
  taskId: z.string().min(1),
  toStatus: z.enum([
    'open',
    'done',
    'migrated',
    'cancelled',
    'in-progress',
    'in-review',
    'blocked',
  ]),
})

const SaveConfigSchema = z.object({
  viewMode: z.enum(['list', 'kanban']),
  lanes: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      taskStatuses: z.array(
        z.enum(['open', 'done', 'migrated', 'cancelled', 'in-progress', 'in-review', 'blocked'])
      ),
    })
  ),
  swimlaneGrouping: z.enum(['none', 'project', 'area']),
})

export function registerKanbanIpcHandlers(): () => void {
  const getConfigHandler = ipcMain.handle('task-vault:kanban:get-config', () => {
    try {
      return readConfig()
    } catch (err) {
      return { error: String(err) }
    }
  })

  const saveConfigHandler = ipcMain.handle(
    'task-vault:kanban:save-config',
    (_event, payload: unknown) => {
      try {
        const config = SaveConfigSchema.parse(payload)
        writeConfig(config)
        return { ok: true }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  const listTasksHandler = ipcMain.handle('task-vault:kanban:list-tasks', () => {
    try {
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT t.id, t.text, t.status, p.name AS project, t.context, a.name AS area,
                  t.due_date, t.terminator_links, t.metadata
           FROM tasks t
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN areas a ON t.area_id = a.id
           WHERE t.status NOT IN ('migrated', 'cancelled')
             AND t.parent_id IS NULL
           ORDER BY t.sort_order, t.created_at`
        )
        .all() as Record<string, unknown>[]
      const tasks = rows.map((r) => {
        let description: string | undefined
        try {
          const meta = JSON.parse((r.metadata as string) || '{}') as Record<string, string>
          description = meta.description || undefined
        } catch {
          description = undefined
        }
        return {
          id: r.id as string,
          text: r.text as string,
          status: r.status as TaskStatus,
          project: (r.project as string) || undefined,
          context: (r.context as string) || undefined,
          area: (r.area as string) || undefined,
          dueDate: (r.due_date as string) || undefined,
          terminatorLinks: JSON.parse((r.terminator_links as string) || '[]') as string[],
          description,
        }
      })
      return { tasks }
    } catch (err) {
      return { error: String(err) }
    }
  })

  const listContextsHandler = ipcMain.handle('task-vault:kanban:list-contexts', () => {
    try {
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT DISTINCT context FROM tasks
           WHERE context IS NOT NULL AND context != ''
           ORDER BY context`
        )
        .all() as { context: string }[]
      return { contexts: rows.map((r) => r.context) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  const moveTaskHandler = ipcMain.handle(
    'task-vault:kanban:move-task',
    (_event, payload: unknown) => {
      try {
        const { taskId, toStatus } = MoveTaskSchema.parse(payload)
        const db = getDb()
        const now = new Date().toISOString()
        const result = db
          .prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
          .run(toStatus, now, taskId)
        if (result.changes === 0) {
          return { error: 'Task not found' }
        }
        return { ok: true }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  return () => {
    ipcMain.removeHandler('task-vault:kanban:get-config')
    ipcMain.removeHandler('task-vault:kanban:save-config')
    ipcMain.removeHandler('task-vault:kanban:list-tasks')
    ipcMain.removeHandler('task-vault:kanban:list-contexts')
    ipcMain.removeHandler('task-vault:kanban:move-task')
    void getConfigHandler
    void saveConfigHandler
    void listTasksHandler
    void listContextsHandler
    void moveTaskHandler
  }
}
