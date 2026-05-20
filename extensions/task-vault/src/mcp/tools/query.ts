import { readIndex } from '../../vault/indexer'
import type { TaskStatus, IndexedTask } from '../../vault/types'

interface QueryInput {
  status?: TaskStatus | TaskStatus[]
  context?: string
  project?: string
  area?: string
  dueBefore?: string
  filePattern?: string
}

export async function queryTasks(
  input: QueryInput,
  vaultPath: string
): Promise<{ tasks: IndexedTask[] } | { error: string }> {
  const index = await readIndex(vaultPath)
  if (!index) return { tasks: [] }

  let tasks = index.tasks

  if (input.status) {
    const statuses = Array.isArray(input.status) ? input.status : [input.status]
    tasks = tasks.filter((t) => statuses.includes(t.status))
  }
  if (input.context) tasks = tasks.filter((t) => t.context === input.context)
  if (input.project) tasks = tasks.filter((t) => t.project === input.project)
  if (input.area) tasks = tasks.filter((t) => t.area === input.area)
  if (input.dueBefore) tasks = tasks.filter((t) => t.dueDate && t.dueDate < input.dueBefore!)
  if (input.filePattern) tasks = tasks.filter((t) => t.filePath.includes(input.filePattern!))

  return { tasks }
}
