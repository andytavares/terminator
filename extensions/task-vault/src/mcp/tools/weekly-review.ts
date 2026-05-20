import { readIndex } from '../../vault/indexer'
import type { IndexedTask, IndexedProject } from '../../vault/types'

interface WeeklyReviewResult {
  inboxItems: IndexedTask[]
  activeProjects: IndexedProject[]
  staleProjects: IndexedProject[]
  someDayProjects: IndexedProject[]
  completedLastWeek: IndexedTask[]
  lastReviewDate?: string
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function weeklyReviewMcp(
  vaultPath: string
): Promise<WeeklyReviewResult | { error: string }> {
  const index = await readIndex(vaultPath)
  if (!index) return { error: 'No index found. Run a full index build first.' }

  const cutoff = new Date(Date.now() - ONE_WEEK_MS)

  const inboxItems = index.tasks.filter(
    (t) => t.filePath.includes('inbox.md') && t.status === 'open'
  )

  const activeProjects = index.projects.filter((p) => p.status === 'active' && !p.isStale)
  const staleProjects = index.projects.filter((p) => p.status === 'active' && p.isStale)
  const someDayProjects = index.projects.filter((p) => p.status === 'someday')

  const completedLastWeek = index.tasks.filter((t) => {
    if (t.status !== 'done') return false
    // Approximate: filter daily files by filename date
    const dateMatch = /(\d{4}-\d{2}-\d{2})\.md$/.exec(t.filePath)
    if (!dateMatch) return false
    return new Date(dateMatch[1]) >= cutoff
  })

  return {
    inboxItems,
    activeProjects,
    staleProjects,
    someDayProjects,
    completedLastWeek,
  }
}
