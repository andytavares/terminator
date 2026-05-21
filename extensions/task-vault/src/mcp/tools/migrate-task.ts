import { getDb, randomUUID } from '../../vault/db'
import { getAutoExecuteSetting, makeSuggestion } from '../auto-execute'

interface MigrateTaskInput {
  taskId: string
  targetDate: string
  confirmed?: boolean
}

export async function migrateTaskMcp(
  input: MigrateTaskInput,
  vaultPath: string
): Promise<
  | { newTaskId: string }
  | { error: string }
  | { suggestion: string; tool: string; description: string }
> {
  const db = getDb()
  const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(input.taskId) as
    | Record<string, unknown>
    | undefined
  if (!task) return { error: 'STALE_ID' }

  if (!input.confirmed) {
    const autoExecute = await getAutoExecuteSetting('migrate_task', vaultPath)
    if (!autoExecute) {
      return makeSuggestion(
        'migrate_task',
        `Would migrate task "${task.text as string}" to ${input.targetDate}`
      )
    }
  }

  const now = new Date().toISOString()
  db.prepare(`UPDATE tasks SET status='migrated', migrated_to=?, updated_at=? WHERE id=?`).run(
    input.targetDate,
    now,
    input.taskId
  )

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
    input.targetDate,
    now,
    now
  )
  return { newTaskId: newId }
}
