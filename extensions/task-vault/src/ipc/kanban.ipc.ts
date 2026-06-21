import { ipcMain } from 'electron'
import { z } from 'zod'
import type { ExtensionDB } from '../../../../src/main/extensions/api'
import type { KanbanConfig, TaskStatus } from '../vault/types'
import { DEFAULT_KANBAN_CONFIG } from '../vault/types'

async function readConfig(db: ExtensionDB): Promise<KanbanConfig> {
  try {
    const row = await db.get<{ value: string }>(
      `SELECT value FROM settings WHERE key='kanban_config'`
    )
    if (!row) return { ...DEFAULT_KANBAN_CONFIG }
    return JSON.parse(row.value) as KanbanConfig
  } catch {
    return { ...DEFAULT_KANBAN_CONFIG }
  }
}

async function writeConfig(db: ExtensionDB, config: KanbanConfig): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value) VALUES ('kanban_config', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(config)]
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

export function registerKanbanIpcHandlers(db: ExtensionDB): () => void {
  const getConfigHandler = ipcMain.handle('task-vault:kanban:get-config', async () => {
    try {
      return await readConfig(db)
    } catch (err) {
      return { error: String(err) }
    }
  })

  const saveConfigHandler = ipcMain.handle(
    'task-vault:kanban:save-config',
    async (_event, payload: unknown) => {
      try {
        const config = SaveConfigSchema.parse(payload)
        await writeConfig(db, config)
        return { ok: true }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  const listTasksHandler = ipcMain.handle('task-vault:kanban:list-tasks', async () => {
    try {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT t.id, t.text, t.status, p.name AS project, t.context, a.name AS area,
                t.due_date, t.terminator_links, t.metadata
         FROM tasks t
         LEFT JOIN projects p ON t.project_id = p.id
         LEFT JOIN areas a ON t.area_id = a.id
         WHERE t.status NOT IN ('migrated', 'cancelled')
           AND t.parent_id IS NULL
         ORDER BY t.sort_order, t.created_at`
      )
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

  const listContextsHandler = ipcMain.handle('task-vault:kanban:list-contexts', async () => {
    try {
      const rows = await db.query<{ context: string }>(
        `SELECT DISTINCT context FROM tasks
         WHERE context IS NOT NULL AND context != ''
         ORDER BY context`
      )
      return { contexts: rows.map((r) => r.context) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  const moveTaskHandler = ipcMain.handle(
    'task-vault:kanban:move-task',
    async (_event, payload: unknown) => {
      try {
        const { taskId, toStatus } = MoveTaskSchema.parse(payload)
        const now = new Date().toISOString()
        const existing = await db.get<{ id: string }>(`SELECT id FROM tasks WHERE id=?`, [taskId])
        if (!existing) return { error: 'Task not found' }
        await db.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`, [
          toStatus,
          now,
          taskId,
        ])
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
