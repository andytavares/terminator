import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { ipcMain } from 'electron'
import matter from 'gray-matter'
import { readIndex, buildIndex } from '../vault/indexer'
import { writeFileAtomic } from '../vault/writer'
import {
  ListProjectsRequestSchema,
  UpdateProjectStatusRequestSchema,
} from '../schemas/vault.schema'
import type { ProjectStatus } from '../vault/types'

let vaultPath = ''

export function setVaultPath(p: string) {
  vaultPath = p
}

export function registerProjectsIpcHandlers(): () => void {
  const handlers: string[] = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, fn)
    handlers.push(channel)
  }

  handle('task-vault:projects:list', async (_event, payload) => {
    const parsed = ListProjectsRequestSchema.safeParse(payload ?? {})
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const index = await readIndex(vaultPath)
    if (!index) return { projects: [] }

    const statusFilter: ProjectStatus[] = parsed.data.status
      ? Array.isArray(parsed.data.status)
        ? (parsed.data.status as ProjectStatus[])
        : [parsed.data.status as ProjectStatus]
      : ['active']

    const projects = index.projects.filter((p) => statusFilter.includes(p.status as ProjectStatus))
    return { projects }
  })

  handle('task-vault:projects:weekly-review', async () => {
    const index = await readIndex(vaultPath)
    const inboxFile = path.join(vaultPath, 'inbox.md')

    // Inbox items
    let inboxItems: unknown[] = []
    try {
      const { parseFile } = await import('../vault/parser.js')
      const inboxContent = await fs.readFile(inboxFile, 'utf-8').catch(() => '')
      const parsed = parseFile(inboxContent, inboxFile)
      inboxItems = parsed.tasks.filter((t) => t.status === 'open')
    } catch {
      /* ignore */
    }

    // Projects by status
    const allProjects = index?.projects ?? []
    const activeProjects = allProjects.filter((p) => p.status === 'active')
    const staleProjects = activeProjects.filter((p) => p.isStale)
    const somedayProjects = allProjects.filter((p) => p.status === 'someday')

    // Completed tasks in last 7 days
    const completedLastWeek: unknown[] = []
    const dailyDir = path.join(vaultPath, 'daily')
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    let lastReviewDate: string | null = null

    try {
      const { parseFile } = await import('../vault/parser.js')
      const entries = await fs.readdir(dailyDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const dateStr = entry.name.replace('.md', '')
        const fileDate = new Date(dateStr)
        if (fileDate < sevenDaysAgo) continue
        const content = await fs.readFile(path.join(dailyDir, entry.name), 'utf-8').catch(() => '')
        const result = parseFile(content, path.join(dailyDir, entry.name))
        const done = result.tasks.filter((t) => t.status === 'done')
        completedLastWeek.push(...done)
        // Check for weekly review completion marker in notes
        const hasReviewNote = result.notes.some((n) =>
          n.text.toLowerCase().includes('weekly review')
        )
        if (hasReviewNote && (!lastReviewDate || dateStr > lastReviewDate)) {
          lastReviewDate = dateStr
        }
      }
    } catch {
      /* ignore */
    }

    return {
      inboxItems,
      activeProjects,
      staleProjects,
      somedayProjects,
      completedLastWeek,
      lastReviewDate,
    }
  })

  handle('task-vault:vault:update-project-status', async (_event, payload) => {
    const parsed = UpdateProjectStatusRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { projectFilePath, status } = parsed.data
    const fullPath = path.isAbsolute(projectFilePath)
      ? projectFilePath
      : path.join(vaultPath, projectFilePath)
    const content = await fs.readFile(fullPath, 'utf-8').catch(() => '')
    const parsed2 = matter(content)
    parsed2.data.status = status
    const updated = matter.stringify(parsed2.content, parsed2.data)
    await writeFileAtomic(fullPath, updated)
    await buildIndex(vaultPath)
    return { success: true }
  })

  return () => {
    for (const channel of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
