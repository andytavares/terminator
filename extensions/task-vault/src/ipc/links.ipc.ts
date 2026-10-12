import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { createIpcRegistrar, errorResult } from './register'
import {
  LinksCreateRequestSchema,
  LinksRemoveRequestSchema,
  LinksGetForTargetRequestSchema,
} from '../schemas/vault.schema'
import { rowToTask, rowToProject, PROJECT_COLS, PROJECT_JOINS } from '../vault/mappers'

export function registerLinksIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handleRemote, cleanup } = createIpcRegistrar(api, errorResult)

  handleRemote('task-vault:links:create', LinksCreateRequestSchema, async (args) => {
    const { taskId, projectFilePath, targetId } = args
    const now = new Date().toISOString()
    try {
      if (taskId) {
        const task = await db.get<{ terminator_links: string }>(
          `SELECT terminator_links FROM tasks WHERE id=?`,
          [taskId]
        )
        if (!task) return { error: 'NOT_FOUND' }
        // Replace all existing links — a task links to exactly one terminal at a time.
        await db.run(`UPDATE tasks SET terminator_links=?, updated_at=? WHERE id=?`, [
          JSON.stringify([targetId]),
          now,
          taskId,
        ])
      } else if (projectFilePath) {
        const project = await db.get<{ terminator_links: string }>(
          `SELECT terminator_links FROM projects WHERE name=?`,
          [projectFilePath]
        )
        if (!project) return { error: 'NOT_FOUND' }
        const links: string[] = JSON.parse(project.terminator_links || '[]')
        if (!links.includes(targetId)) links.push(targetId)
        await db.run(`UPDATE projects SET terminator_links=?, updated_at=? WHERE name=?`, [
          JSON.stringify(links),
          now,
          projectFilePath,
        ])
      }
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleRemote('task-vault:links:remove', LinksRemoveRequestSchema, async (args) => {
    const { taskId, projectFilePath, targetId } = args
    const now = new Date().toISOString()
    try {
      if (taskId) {
        const task = await db.get<{ terminator_links: string }>(
          `SELECT terminator_links FROM tasks WHERE id=?`,
          [taskId]
        )
        if (!task) return { error: 'NOT_FOUND' }
        const links: string[] = JSON.parse(task.terminator_links || '[]').filter(
          (l: string) => l !== targetId
        )
        await db.run(`UPDATE tasks SET terminator_links=?, updated_at=? WHERE id=?`, [
          JSON.stringify(links),
          now,
          taskId,
        ])
      } else if (projectFilePath) {
        const project = await db.get<{ terminator_links: string }>(
          `SELECT terminator_links FROM projects WHERE name=?`,
          [projectFilePath]
        )
        if (!project) return { error: 'NOT_FOUND' }
        const links: string[] = JSON.parse(project.terminator_links || '[]').filter(
          (l: string) => l !== targetId
        )
        await db.run(`UPDATE projects SET terminator_links=?, updated_at=? WHERE name=?`, [
          JSON.stringify(links),
          now,
          projectFilePath,
        ])
      }
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleRemote(
    'task-vault:links:get-for-terminator-target',
    LinksGetForTargetRequestSchema,
    async (args) => {
      const { targetId } = args
      const escapedId = targetId.replace(/[%_]/g, '\\$&')
      const taskRows = await db.query<Record<string, unknown>>(
        `SELECT * FROM tasks WHERE terminator_links LIKE ? ESCAPE '\\'`,
        [`%${escapedId}%`]
      )
      const tasks = taskRows.map(rowToTask).filter((t) => t.terminatorLinks.includes(targetId))

      const projectRows = await db.query<Record<string, unknown>>(
        `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.terminator_links LIKE ? ESCAPE '\\'`,
        [`%${escapedId}%`]
      )
      const projects = projectRows
        .map(rowToProject)
        .filter((p) => p.terminatorLinks.includes(targetId))

      return { tasks, projects }
    }
  )

  return cleanup
}
