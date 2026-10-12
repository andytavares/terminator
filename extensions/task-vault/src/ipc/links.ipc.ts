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

  handleRemote('task-vault:links:create', LinksCreateRequestSchema, (args) =>
    // A task links to exactly one terminal at a time; a project to any number.
    changeLinks(db, args, (links, isTask) =>
      isTask ? [args.targetId] : links.includes(args.targetId) ? links : [...links, args.targetId]
    )
  )

  handleRemote('task-vault:links:remove', LinksRemoveRequestSchema, (args) =>
    changeLinks(db, args, (links) => links.filter((l) => l !== args.targetId))
  )

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

/**
 * Rewrites the terminal links of the task `taskId`, or else the project named
 * `projectFilePath`, to `change(current links, isTask)`.
 */
async function changeLinks(
  db: ExtensionDB,
  owner: { taskId?: string; projectFilePath?: string },
  change: (links: string[], isTask: boolean) => string[]
): Promise<{ success: true } | { error: string }> {
  const { taskId, projectFilePath } = owner
  const at = taskId
    ? { table: 'tasks', key: 'id', value: taskId }
    : projectFilePath
      ? { table: 'projects', key: 'name', value: projectFilePath }
      : null
  if (!at) return { success: true }
  try {
    const row = await db.get<{ terminator_links: string }>(
      `SELECT terminator_links FROM ${at.table} WHERE ${at.key}=?`,
      [at.value]
    )
    if (!row) return { error: 'NOT_FOUND' }
    const links = change(JSON.parse(row.terminator_links || '[]') as string[], at.table === 'tasks')
    await db.run(`UPDATE ${at.table} SET terminator_links=?, updated_at=? WHERE ${at.key}=?`, [
      JSON.stringify(links),
      new Date().toISOString(),
      at.value,
    ])
    return { success: true }
  } catch (err) {
    return { error: String(err) }
  }
}
