import { completeTask } from '../../vault/writer'
import { buildIndex, readIndex, getTaskById } from '../../vault/indexer'
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
  const index = await readIndex(vaultPath)
  const task = index ? getTaskById(index, input.taskId) : null
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

  const result = await completeTask(task.filePath, task.line, today())
  if (result && 'error' in result) return result
  await buildIndex(vaultPath)
  return { success: true }
}
