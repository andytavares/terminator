import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseFile } from './parser'
import type { VaultIndex, IndexedTask, IndexedProject } from './types'

const INDEX_PATH = '.todo/index.json'

export async function buildIndex(vaultPath: string): Promise<VaultIndex> {
  const tasks: IndexedTask[] = []
  const projects: IndexedProject[] = []

  // Parse daily files
  const dailyDir = path.join(vaultPath, 'daily')
  try {
    const entries = await fs.readdir(dailyDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === 'archive') continue
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const filePath = path.join(dailyDir, entry.name)
      const content = await fs.readFile(filePath, 'utf-8')
      const { tasks: fileTasks } = parseFile(content, filePath)
      for (const t of fileTasks) {
        tasks.push({
          id: t.id,
          filePath: t.filePath,
          line: t.line,
          status: t.status,
          text: t.text,
          project: t.project,
          context: t.context,
          area: t.area,
          dueDate: t.dueDate,
          terminatorLinks: t.terminatorLinks,
        })
      }
    }
  } catch {
    // daily dir may not exist yet
  }

  // Count inbox items
  let inboxCount = 0
  const inboxFile = path.join(vaultPath, 'inbox.md')
  try {
    const inboxContent = await fs.readFile(inboxFile, 'utf-8')
    const { tasks: inboxTasks } = parseFile(inboxContent, inboxFile)
    inboxCount = inboxTasks.filter((t) => t.status === 'open').length
    for (const t of inboxTasks) {
      tasks.push({
        id: t.id,
        filePath: t.filePath,
        line: t.line,
        status: t.status,
        text: t.text,
        project: t.project,
        context: t.context,
        area: t.area,
        dueDate: t.dueDate,
        terminatorLinks: t.terminatorLinks,
      })
    }
  } catch {
    // inbox may not exist yet
  }

  // Parse project files
  const projectsDir = path.join(vaultPath, 'projects')
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const filePath = path.join(projectsDir, entry.name)
      const content = await fs.readFile(filePath, 'utf-8')
      const { tasks: projTasks, frontmatter } = parseFile(content, filePath)
      const stat = await fs.stat(filePath)
      const nextActions = projTasks.filter((t) => t.status === 'open')
      const fm = frontmatter ?? {}
      projects.push({
        id: filePath,
        filePath,
        name: entry.name.replace(/\.md$/, ''),
        status: (fm.status as string) ?? 'active',
        deadline: fm.deadline as string | undefined,
        area: fm.area as string | undefined,
        isStale: nextActions.length === 0,
        nextActionCount: nextActions.length,
        lastModified: stat.mtime.toISOString(),
        terminatorLinks: [],
      })
      for (const t of projTasks) {
        tasks.push({
          id: t.id,
          filePath: t.filePath,
          line: t.line,
          status: t.status,
          text: t.text,
          project: t.project,
          context: t.context,
          area: t.area,
          dueDate: t.dueDate,
          terminatorLinks: t.terminatorLinks,
        })
      }
    }
  } catch {
    // projects dir may not exist yet
  }

  const index: VaultIndex = {
    version: 1,
    builtAt: new Date().toISOString(),
    vaultPath,
    tasks,
    projects,
    inboxCount,
  }

  // Write index to .todo/index.json
  const indexFile = path.join(vaultPath, INDEX_PATH)
  await fs.mkdir(path.dirname(indexFile), { recursive: true })
  await fs.writeFile(indexFile, JSON.stringify(index, null, 2), 'utf-8')

  return index
}

export async function readIndex(vaultPath: string): Promise<VaultIndex | null> {
  const indexFile = path.join(vaultPath, INDEX_PATH)
  try {
    const content = await fs.readFile(indexFile, 'utf-8')
    return JSON.parse(content) as VaultIndex
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export function getTaskById(index: VaultIndex, id: string): import('./types').IndexedTask | null {
  return index.tasks.find((t) => t.id === id) ?? null
}
