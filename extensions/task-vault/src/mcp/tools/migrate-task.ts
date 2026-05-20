import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { migrateTask } from '../../vault/writer'
import { buildIndex, readIndex, getTaskById } from '../../vault/indexer'
import { parseFile } from '../../vault/parser'
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
  const index = await readIndex(vaultPath)
  const task = index ? getTaskById(index, input.taskId) : null
  if (!task) return { error: 'STALE_ID' }

  if (!input.confirmed) {
    const autoExecute = await getAutoExecuteSetting('migrate_task', vaultPath)
    if (!autoExecute) {
      return makeSuggestion(
        'migrate_task',
        `Would migrate task "${task.text}" to ${input.targetDate}`
      )
    }
  }

  const result = await migrateTask(task.filePath, task.line, input.targetDate, vaultPath)
  if (result && 'error' in result) return result
  await buildIndex(vaultPath)

  const targetFile = path.join(vaultPath, 'daily', `${input.targetDate}.md`)
  const content = await fs.readFile(targetFile, 'utf-8').catch(() => '')
  const { tasks } = parseFile(content, targetFile)
  const last = tasks[tasks.length - 1]
  return { newTaskId: last?.id ?? '' }
}
