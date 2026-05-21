import { getDb } from '../../vault/db'
import type { ProjectStatus, IndexedProject } from '../../vault/types'

interface ListProjectsInput {
  status?: ProjectStatus | ProjectStatus[]
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

export async function listProjectsMcp(
  input: ListProjectsInput,
  _vaultPath: string
): Promise<{ projects: IndexedProject[] } | { error: string }> {
  try {
    const db = getDb()
    const statuses: ProjectStatus[] = input.status
      ? Array.isArray(input.status)
        ? input.status
        : [input.status]
      : ['active']

    const placeholders = statuses.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT * FROM projects WHERE status IN (${placeholders}) ORDER BY name`)
      .all(...statuses) as Record<string, unknown>[]

    const projects = rows.map((p) => {
      const nextActionCount = (
        db
          .prepare(`SELECT COUNT(*) as c FROM tasks WHERE project=? AND status='open'`)
          .get(p.name) as { c: number }
      ).c
      return { ...rowToProject(p), nextActionCount, isStale: nextActionCount === 0 }
    })

    return { projects }
  } catch (err) {
    return { error: String(err) }
  }
}
