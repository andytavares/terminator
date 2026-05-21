import { getDb } from '../../vault/db'
import type { TaskStatus, IndexedTask } from '../../vault/types'

interface QueryInput {
  status?: TaskStatus | TaskStatus[]
  context?: string
  project?: string
  area?: string
  dueBefore?: string
  filePattern?: string
}

function rowToTask(row: Record<string, unknown>): IndexedTask {
  const source = row.source as string
  const sourceRef = row.source_ref as string | null
  const filePath = sourceRef ? `${source}/${sourceRef}` : source
  return {
    id: row.id as string,
    filePath,
    line: 0,
    status: row.status as TaskStatus,
    text: row.text as string,
    project: (row.project as string) || undefined,
    context: (row.context as string) || undefined,
    area: (row.area as string) || undefined,
    dueDate: (row.due_date as string) || undefined,
    terminatorLinks: JSON.parse((row.terminator_links as string) || '[]'),
    subtasks: [],
  }
}

export async function queryTasks(
  input: QueryInput,
  _vaultPath: string
): Promise<{ tasks: IndexedTask[] } | { error: string }> {
  try {
    const db = getDb()
    const conditions: string[] = []
    const params: unknown[] = []

    if (input.status) {
      const statuses = Array.isArray(input.status) ? input.status : [input.status]
      conditions.push(`status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    }
    if (input.context) { conditions.push(`context=?`); params.push(input.context) }
    if (input.project) { conditions.push(`project=?`); params.push(input.project) }
    if (input.area) { conditions.push(`area=?`); params.push(input.area) }
    if (input.dueBefore) { conditions.push(`due_date < ?`); params.push(input.dueBefore) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    let rows = db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at`).all(...params) as Record<string, unknown>[]

    // filePattern still supported: filter by virtual filePath
    if (input.filePattern) {
      rows = rows.filter((r) => {
        const source = r.source as string
        const sourceRef = r.source_ref as string | null
        const filePath = sourceRef ? `${source}/${sourceRef}` : source
        return filePath.includes(input.filePattern!)
      })
    }

    return { tasks: rows.map(rowToTask) }
  } catch (err) {
    return { error: String(err) }
  }
}
