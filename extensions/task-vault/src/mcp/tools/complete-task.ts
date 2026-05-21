import { getDb } from '../../vault/db'
import { getAutoExecuteSetting, makeSuggestion } from '../auto-execute'

interface CompleteTaskInput {
  taskId: string
  confirmed?: boolean
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function completeTaskMcp(
  input: CompleteTaskInput,
  vaultPath: string
): Promise<
  { success: true } | { error: string } | { suggestion: string; tool: string; description: string }
> {
  const db = getDb()
  const task = db.prepare(`SELECT id, text FROM tasks WHERE id=?`).get(input.taskId) as
    | { id: string; text: string }
    | undefined
  if (!task) return { error: 'STALE_ID' }

  if (!input.confirmed) {
    const autoExecute = await getAutoExecuteSetting('complete_task', vaultPath)
    if (!autoExecute) {
      return makeSuggestion(
        'complete_task',
        `Would complete task: "${task.text}" (${input.taskId})`
      )
    }
  }

  const now = new Date().toISOString()
  db.prepare(`UPDATE tasks SET status='done', completed_date=?, updated_at=? WHERE id=?`).run(
    today(),
    now,
    input.taskId
  )
  return { success: true }
}
