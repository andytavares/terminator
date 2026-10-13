import type { ExtensionDB } from '@terminator/extension-sdk'
import { rowToTask, TASK_COLS, TASK_JOINS } from './mappers'
import type { IndexedTask } from './types'

/** The top-level tasks of the daily log for `date`, in order, each with its subtasks. */
export async function dailyTasks(db: ExtensionDB, date: string): Promise<IndexedTask[]> {
  const taskRows = await db.query<Record<string, unknown>>(
    `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
     WHERE t.source='daily' AND t.source_ref=? AND t.parent_id IS NULL ORDER BY t.sort_order, t.created_at`,
    [date]
  )
  const tasks = taskRows.map(rowToTask)
  for (const task of tasks) {
    const subtaskRows = await db.query<Record<string, unknown>>(
      `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS} WHERE t.parent_id=? ORDER BY t.sort_order, t.created_at`,
      [task.id]
    )
    task.subtasks = subtaskRows.map(rowToTask)
  }
  return tasks
}

/** A task's metadata object, or null when there is no such task. */
export async function taskMetadata(
  db: ExtensionDB,
  taskId: string
): Promise<Record<string, unknown> | null> {
  const row = await db.get<{ metadata: string }>(`SELECT metadata FROM tasks WHERE id=?`, [taskId])
  if (!row) return null
  return JSON.parse(row.metadata || '{}') as Record<string, unknown>
}

/**
 * Opens a finished or migrated task again: deletes the twin a migration left,
 * reopens its migrated subtasks, and, given `dailyDate`, moves it to that day's
 * log. False when there is no such task.
 */
export async function reopenTask(
  db: ExtensionDB,
  taskId: string,
  dailyDate: string | null
): Promise<boolean> {
  const meta = await taskMetadata(db, taskId)
  if (!meta) return false
  const now = new Date().toISOString()
  const twinId = meta.migration_twin_id as string | undefined
  if (twinId) {
    await db.run(`DELETE FROM tasks WHERE parent_id=?`, [twinId])
    await db.run(`DELETE FROM tasks WHERE id=?`, [twinId])
    delete meta.migration_twin_id
  }
  await db.run(
    `UPDATE tasks SET status='open', migrated_to=NULL, metadata=json_remove(metadata, '$.migration_twin_id'), updated_at=? WHERE parent_id=? AND status='migrated'`,
    [now, taskId]
  )
  const [daily, dailyArgs] = dailyDate ? [`source='daily', source_ref=?, `, [dailyDate]] : ['', []]
  await db.run(
    `UPDATE tasks SET status='open', ${daily}completed_date=NULL, migrated_to=NULL, metadata=?, updated_at=? WHERE id=?`,
    [...dailyArgs, JSON.stringify(meta), now, taskId]
  )
  return true
}
