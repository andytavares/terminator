import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { addTask } from '../../vault/writer'
import { buildIndex } from '../../vault/indexer'
import { parseFile } from '../../vault/parser'
import { getAutoExecuteSetting, makeSuggestion } from '../auto-execute'

interface AddTaskInput {
  filePath: string
  text: string
  section?: string
  dueDate?: string
  tags?: { project?: string; context?: string; area?: string }
  confirmed?: boolean
}

export async function addTaskMcp(
  input: AddTaskInput,
  vaultPath: string
): Promise<
  { taskId: string } | { error: string } | { suggestion: string; tool: string; description: string }
> {
  if (!input.confirmed) {
    const autoExecute = await getAutoExecuteSetting('add_task', vaultPath)
    if (!autoExecute) {
      return makeSuggestion('add_task', `Would add task "${input.text}" to ${input.filePath}`)
    }
  }

  const parts: string[] = [input.text]
  if (input.tags?.project) parts.push(`+${input.tags.project}`)
  if (input.tags?.context) parts.push(`@${input.tags.context}`)
  if (input.tags?.area) parts.push(`#${input.tags.area}`)
  if (input.dueDate) parts.push(`due:${input.dueDate}`)

  const fullPath = path.isAbsolute(input.filePath)
    ? input.filePath
    : path.join(vaultPath, input.filePath)
  await addTask(fullPath, parts.join(' '), input.section)
  await buildIndex(vaultPath)

  const content = await fs.readFile(fullPath, 'utf-8').catch(() => '')
  const { tasks } = parseFile(content, fullPath)
  const last = tasks[tasks.length - 1]
  return { taskId: last?.id ?? '' }
}
