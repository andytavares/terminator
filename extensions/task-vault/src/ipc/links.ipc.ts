import type { z } from 'zod'
import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { registerRoutes, route, type IpcContext } from './register'
import {
  LinksCreateRequestSchema,
  LinksRemoveRequestSchema,
  LinksGetForTargetRequestSchema,
} from '../schemas/vault.schema'
import { rowToTask, rowToProject, PROJECT_COLS, PROJECT_JOINS } from '../vault/mappers'
import { nowIso, orErrorString } from './vault-shared'

type LinkArgs = z.infer<typeof LinksCreateRequestSchema>

/** Where a task's or a project's terminal links live: its table and the key column. */
interface LinkOwner {
  table: 'tasks' | 'projects'
  column: 'id' | 'name'
  key: string
}

function ownerOf(args: LinkArgs): LinkOwner | null {
  if (args.taskId) return { table: 'tasks', column: 'id', key: args.taskId }
  if (args.projectFilePath) return { table: 'projects', column: 'name', key: args.projectFilePath }
  return null
}

/**
 * Rewrites an owner's link list with `change`; answers NOT_FOUND for an unknown owner
 * and does nothing when the payload names no owner.
 */
async function updateLinks(db: ExtensionDB, args: LinkArgs, change: (links: string[]) => string[]) {
  const owner = ownerOf(args)
  if (!owner) return { success: true }
  const { table, column, key } = owner
  const row = await db.get<{ terminator_links: string }>(
    `SELECT terminator_links FROM ${table} WHERE ${column}=?`,
    [key]
  )
  if (!row) return { error: 'NOT_FOUND' }
  const links = change(JSON.parse(row.terminator_links || '[]') as string[])
  await db.run(`UPDATE ${table} SET terminator_links=?, updated_at=? WHERE ${column}=?`, [
    JSON.stringify(links),
    nowIso(),
    key,
  ])
  return { success: true }
}

/**
 * A task links to exactly one terminal at a time, so linking replaces its list;
 * a project collects links.
 */
function createLink({ db }: IpcContext, args: LinkArgs) {
  const { targetId } = args
  return orErrorString(() =>
    updateLinks(db, args, (links) => {
      if (args.taskId) return [targetId]
      if (links.includes(targetId)) return links
      return [...links, targetId]
    })
  )
}

function removeLink({ db }: IpcContext, args: z.infer<typeof LinksRemoveRequestSchema>) {
  return orErrorString(() =>
    updateLinks(db, args, (links) => links.filter((l) => l !== args.targetId))
  )
}

async function linkedToTarget(
  { db }: IpcContext,
  args: z.infer<typeof LinksGetForTargetRequestSchema>
) {
  const { targetId } = args
  const pattern = `%${targetId.replace(/[%_]/g, '\\$&')}%`
  const taskRows = await db.query<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE terminator_links LIKE ? ESCAPE '\\'`,
    [pattern]
  )
  const projectRows = await db.query<Record<string, unknown>>(
    `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.terminator_links LIKE ? ESCAPE '\\'`,
    [pattern]
  )
  return {
    tasks: taskRows.map(rowToTask).filter((t) => t.terminatorLinks.includes(targetId)),
    projects: projectRows.map(rowToProject).filter((p) => p.terminatorLinks.includes(targetId)),
  }
}

const LINK_ROUTES = [
  route('task-vault:links:create', LinksCreateRequestSchema, createLink),
  route('task-vault:links:remove', LinksRemoveRequestSchema, removeLink),
  route(
    'task-vault:links:get-for-terminator-target',
    LinksGetForTargetRequestSchema,
    linkedToTarget
  ),
]

export function registerLinksIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  return registerRoutes({ api, db }, LINK_ROUTES)
}
