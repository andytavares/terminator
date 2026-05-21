import { getDb } from '../../vault/db'
import type { DailyLog, IndexedTask, TaskStatus } from '../../vault/types'

function today(): string {
  return new Date().toISOString().slice(0, 10)
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

export async function getTodayLog(_vaultPath: string): Promise<DailyLog | { error: string }> {
  try {
    const date = today()
    const db = getDb()
    const taskRows = db
      .prepare(
        `SELECT * FROM tasks WHERE source='daily' AND source_ref=? AND parent_id IS NULL ORDER BY sort_order, created_at`
      )
      .all(date) as Record<string, unknown>[]
    const tasks = taskRows.map(rowToTask)
    for (const task of tasks) {
      task.subtasks = (
        db
          .prepare(`SELECT * FROM tasks WHERE parent_id=? ORDER BY sort_order, created_at`)
          .all(task.id) as Record<string, unknown>[]
      ).map(rowToTask)
    }
    const events = db.prepare(`SELECT * FROM events WHERE date=? ORDER BY time`).all(date) as {
      time?: string
      text: string
    }[]
    const notes = db.prepare(`SELECT * FROM notes WHERE date=? ORDER BY rowid`).all(date) as {
      text: string
    }[]
    return {
      date,
      filePath: `daily/${date}.md`,
      tasks,
      events,
      notes,
      exists: tasks.length > 0 || events.length > 0 || notes.length > 0,
    }
  } catch (err) {
    return { error: String(err) }
  }
}
