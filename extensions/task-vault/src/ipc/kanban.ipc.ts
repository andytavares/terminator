import { z } from 'zod'
import { noPayload, type ExtensionAPI, type ExtensionDB } from '@terminator/extension-sdk'
import { registerRoutes, route, type IpcContext } from './register'
import type { KanbanConfig, TaskStatus } from '../vault/types'
import { DEFAULT_KANBAN_CONFIG } from '../vault/types'
import { nowIso, orErrorString } from './vault-shared'

async function readConfig(db: ExtensionDB): Promise<KanbanConfig> {
  try {
    const row = await db.get<{ value: string }>(
      `SELECT value FROM settings WHERE extension_id='task-vault' AND key='kanban_config'`
    )
    if (!row) return { ...DEFAULT_KANBAN_CONFIG }
    return JSON.parse(row.value) as KanbanConfig
  } catch {
    return { ...DEFAULT_KANBAN_CONFIG }
  }
}

async function writeConfig(db: ExtensionDB, config: KanbanConfig): Promise<void> {
  await db.run(
    `INSERT INTO settings (extension_id, key, value) VALUES ('task-vault', 'kanban_config', ?) ON CONFLICT (extension_id, key) DO UPDATE SET value = excluded.value`,
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

function getConfig({ db }: IpcContext) {
  return orErrorString(() => readConfig(db))
}

function saveConfig({ db }: IpcContext, config: z.infer<typeof SaveConfigSchema>) {
  return orErrorString(async () => {
    await writeConfig(db, config)
    return { ok: true }
  })
}

/** A task's description from its metadata blob; undefined when absent or unreadable. */
function descriptionOf(metadata: unknown): string | undefined {
  try {
    const meta = JSON.parse((metadata as string) || '{}') as Record<string, string>
    return meta.description || undefined
  } catch {
    return undefined
  }
}

/** One card on the board. */
function toCard(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    text: r.text as string,
    status: r.status as TaskStatus,
    project: (r.project as string) || undefined,
    context: (r.context as string) || undefined,
    area: (r.area as string) || undefined,
    dueDate: (r.due_date as string) || undefined,
    terminatorLinks: JSON.parse((r.terminator_links as string) || '[]') as string[],
    description: descriptionOf(r.metadata),
  }
}

function listTasks({ db }: IpcContext) {
  return orErrorString(async () => {
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
    return { tasks: rows.map(toCard) }
  })
}

function listContexts({ db }: IpcContext) {
  return orErrorString(async () => {
    const rows = await db.query<{ context: string }>(
      `SELECT DISTINCT context FROM tasks
         WHERE context IS NOT NULL AND context != ''
         ORDER BY context`
    )
    return { contexts: rows.map((r) => r.context) }
  })
}

function moveTask({ db }: IpcContext, args: z.infer<typeof MoveTaskSchema>) {
  const { taskId, toStatus } = args
  return orErrorString(async () => {
    const now = nowIso()
    const existing = await db.get<{ id: string }>(`SELECT id FROM tasks WHERE id=?`, [taskId])
    if (!existing) return { error: 'Task not found' }
    await db.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`, [
      toStatus,
      now,
      taskId,
    ])
    return { ok: true }
  })
}

const KANBAN_ROUTES = [
  route('task-vault:kanban:get-config', noPayload, getConfig),
  route('task-vault:kanban:save-config', SaveConfigSchema, saveConfig),
  route('task-vault:kanban:list-tasks', noPayload, listTasks),
  route('task-vault:kanban:list-contexts', noPayload, listContexts),
  route('task-vault:kanban:move-task', MoveTaskSchema, moveTask),
]

export function registerKanbanIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  return registerRoutes({ api, db }, KANBAN_ROUTES)
}
