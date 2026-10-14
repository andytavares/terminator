import type { z } from 'zod'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { route, type IpcContext } from './register'
import { randomUUID } from '../vault/db'
import { ProcessInboxRequestSchema } from '../schemas/vault.schema'
import { indexUpdated, nowIso, resolveSource } from './vault-shared'
import { today } from '../vault/clock'

type ProcessArgs = z.infer<typeof ProcessInboxRequestSchema>

interface InboxStep {
  db: ExtensionDB
  taskId: string
  now: string
}

async function trash({ db, taskId }: InboxStep) {
  await db.run(
    `WITH RECURSIVE subtree(id) AS (
          SELECT id FROM tasks WHERE id = ?
          UNION ALL
          SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
        )
        UPDATE tasks SET status='cancelled', updated_at=? WHERE id IN (SELECT id FROM subtree)`,
    [taskId, nowIso()]
  )
}

async function doNow({ db, taskId, now }: InboxStep) {
  const todayDate = today()
  await db.run(
    `UPDATE tasks SET status='in-progress', source='daily', source_ref=?, updated_at=? WHERE id=?`,
    [todayDate, now, taskId]
  )
  await db.run(`UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`, [
    todayDate,
    now,
    taskId,
  ])
}

async function someday({ db, taskId, now }: InboxStep) {
  await db.run(
    `UPDATE tasks SET source='someday', source_ref=NULL, today_since=NULL, updated_at=? WHERE id=?`,
    [now, taskId]
  )
  await db.run(
    `UPDATE tasks SET source='someday', source_ref=NULL, today_since=NULL, updated_at=? WHERE parent_id=?`,
    [now, taskId]
  )
}

const SIMPLE_ACTIONS: Record<string, (step: InboxStep) => Promise<void>> = {
  trash,
  'do-now': doNow,
  someday,
}

interface Filing {
  areaId: string | null
  projectId: string | null
}

async function projectNamed(db: ExtensionDB, name: string, now: string): Promise<string> {
  const proj = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [name])
  if (proj) return proj.id
  const newId = randomUUID()
  await db.run(`INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)`, [
    newId,
    name,
    'active',
    now,
    now,
  ])
  return newId
}

async function filingFor(db: ExtensionDB, destination: string): Promise<Filing> {
  const resolved = resolveSource(destination)
  const filing: Filing = { areaId: null, projectId: null }
  if (resolved.source === 'area' && resolved.sourceRef) {
    const row = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name=?`, [
      resolved.sourceRef,
    ])
    filing.areaId = row?.id ?? null
  } else if (resolved.source === 'project' && resolved.sourceRef) {
    const row = await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [
      resolved.sourceRef,
    ])
    filing.projectId = row?.id ?? null
  }
  return filing
}

/** Files an inbox item under a project or area, onto today's log. */
async function fileInboxItem(step: InboxStep, args: ProcessArgs) {
  const { db, taskId, now } = step
  const { destination, newProjectName } = args
  let filing: Filing
  if (newProjectName) {
    filing = { areaId: null, projectId: await projectNamed(db, newProjectName, now) }
  } else if (destination) {
    filing = await filingFor(db, destination)
  } else {
    return { error: 'destination required for action: file' }
  }
  const params = [today(), filing.areaId, filing.projectId, now, taskId]
  await db.run(
    `UPDATE tasks SET source='daily', source_ref=?, area_id=?, project_id=?, updated_at=? WHERE id=?`,
    params
  )
  await db.run(
    `UPDATE tasks SET source='daily', source_ref=?, area_id=?, project_id=?, updated_at=? WHERE parent_id=?`,
    params
  )
  indexUpdated()
  return { success: true, newTaskId: taskId }
}

async function processInboxItem({ db }: IpcContext, args: ProcessArgs) {
  const { taskId, action } = args
  const now = nowIso()
  const task = await db.get<Record<string, unknown>>(`SELECT * FROM tasks WHERE id=?`, [taskId])
  if (!task) return { error: 'STALE_ID' }
  const step = { db, taskId, now }
  const simple = SIMPLE_ACTIONS[action]
  if (!simple) return fileInboxItem(step, args)
  await simple(step)
  indexUpdated()
  return { success: true }
}

/** The inbox-processing channel. */
export const INBOX_ROUTES = [
  route('task-vault:vault:process-inbox-item', ProcessInboxRequestSchema, processInboxItem),
]
