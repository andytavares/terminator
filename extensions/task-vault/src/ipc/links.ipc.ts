import { ipcMain } from 'electron'
import type { ExtensionDB } from '../../../../src/main/extensions/api'
import {
  LinksCreateRequestSchema,
  LinksRemoveRequestSchema,
  LinksGetForTargetRequestSchema,
} from '../schemas/vault.schema'
import { rowToTask, rowToProject } from '../vault/mappers'

export function registerLinksIpcHandlers(db: ExtensionDB): () => void {
  const channels: string[] = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return await fn(event, payload)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })
    channels.push(channel)
  }

  handle('task-vault:links:create', async (_event, payload) => {
    const parsed = LinksCreateRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, projectFilePath, targetId } = parsed.data
    const now = new Date().toISOString()
    try {
      if (taskId) {
        const task = await db.get<{ terminator_links: string }>(
          `SELECT terminator_links FROM tasks WHERE id=?`,
          [taskId]
        )
        if (!task) return { error: 'NOT_FOUND' }
        const links: string[] = JSON.parse(task.terminator_links || '[]')
        if (!links.includes(targetId)) links.push(targetId)
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

  handle('task-vault:links:remove', async (_event, payload) => {
    const parsed = LinksRemoveRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, projectFilePath, targetId } = parsed.data
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

  handle('task-vault:links:get-for-terminator-target', async (_event, payload) => {
    const parsed = LinksGetForTargetRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { targetId } = parsed.data
    const escapedId = targetId.replace(/[%_]/g, '\\$&')
    const taskRows = await db.query<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE terminator_links LIKE ? ESCAPE '\\'`,
      [`%${escapedId}%`]
    )
    const tasks = taskRows.map(rowToTask).filter((t) => t.terminatorLinks.includes(targetId))

    const projectRows = await db.query<Record<string, unknown>>(
      `SELECT * FROM projects WHERE terminator_links LIKE ? ESCAPE '\\'`,
      [`%${escapedId}%`]
    )
    const projects = projectRows
      .map(rowToProject)
      .filter((p) => p.terminatorLinks.includes(targetId))

    return { tasks, projects }
  })

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel)
    }
  }
}
