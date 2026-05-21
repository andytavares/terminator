import { getDb } from '../../vault/db'
import type { IndexedTask, IndexedProject, TaskStatus, ProjectStatus } from '../../vault/types'

interface WeeklyReviewResult {
  inboxItems: IndexedTask[]
  activeProjects: IndexedProject[]
  staleProjects: IndexedProject[]
  someDayProjects: IndexedProject[]
  completedLastWeek: IndexedTask[]
  lastReviewDate?: string
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

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

function rowToProject(row: Record<string, unknown>): IndexedProject {
  return {
    id: row.id as string,
    filePath: row.name as string,
    name: row.name as string,
    status: row.status as ProjectStatus,
    area: (row.area as string) || undefined,
    deadline: (row.deadline as string) || undefined,
    isStale: false,
    nextActionCount: 0,
    lastModified: row.updated_at as string,
    terminatorLinks: JSON.parse((row.terminator_links as string) || '[]'),
  }
}

export async function weeklyReviewMcp(
  _vaultPath: string
): Promise<WeeklyReviewResult | { error: string }> {
  try {
    const db = getDb()
    const sevenDaysAgo = new Date(Date.now() - ONE_WEEK_MS).toISOString()

    const inboxRows = db
      .prepare(`SELECT * FROM tasks WHERE source='inbox' AND status='open'`)
      .all() as Record<string, unknown>[]
    const inboxItems = inboxRows.map(rowToTask)

    const activeRows = db
      .prepare(`SELECT * FROM projects WHERE status='active'`)
      .all() as Record<string, unknown>[]
    const activeProjects = activeRows.map((p) => {
      const nextActionCount = (
        db
          .prepare(`SELECT COUNT(*) as c FROM tasks WHERE project=? AND status='open'`)
          .get(p.name) as { c: number }
      ).c
      return { ...rowToProject(p), nextActionCount, isStale: nextActionCount === 0 }
    })
    const staleProjects = activeProjects.filter((p) => p.isStale)

    const somedayRows = db
      .prepare(`SELECT * FROM projects WHERE status='someday'`)
      .all() as Record<string, unknown>[]
    const someDayProjects = somedayRows.map(rowToProject)

    const completedRows = db
      .prepare(`SELECT * FROM tasks WHERE status='done' AND updated_at >= ?`)
      .all(sevenDaysAgo) as Record<string, unknown>[]
    const completedLastWeek = completedRows.map(rowToTask)

    return {
      inboxItems,
      activeProjects,
      staleProjects,
      someDayProjects,
      completedLastWeek,
    }
  } catch (err) {
    return { error: String(err) }
  }
}
