import type { z } from 'zod'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { route, type IpcContext } from './register'
import { insertTask } from '../vault/task-repository'
import { randomUUID } from '../vault/db'
import { ensureNextOccurrence } from '../vault/ensure-next-occurrence'
import { broadcast, triggerSchedulerTick } from '../notifications/task-scheduler.js'
import {
  BlockTaskRequestSchema,
  CancelTaskRequestSchema,
  CompleteTaskRequestSchema,
  DeleteTaskRequestSchema,
  GetTaskDetailRequestSchema,
  MigrateTaskRequestSchema,
  ReorderTasksRequestSchema,
  RestoreTaskRequestSchema,
  SaveTaskDetailRequestSchema,
  UnblockTaskRequestSchema,
} from '../schemas/vault.schema'
import {
  deleteTaskTree,
  indexUpdated,
  nowIso,
  orErrorString,
  readTaskMeta,
  taskExists,
} from './vault-shared'
import { today } from '../vault/clock'

type Meta = Record<string, unknown>

type SubRow = {
  id: string
  text: string
  status: string
  sort_order: number | null
  metadata: string
}

interface MigratingTask {
  id: string
  metadata: string
}

interface TwinIds {
  taskId: string
  newId: string
}
type TaskId = { taskId: string }

async function completeTask({ db }: IpcContext, args: z.infer<typeof CompleteTaskRequestSchema>) {
  const { taskId } = args
  const now = nowIso()
  const todayStr = today()
  let nextTaskId: string | null = null
  await db.transaction(async (tx) => {
    const existing = await tx.get<{ id: string }>(`SELECT id FROM tasks WHERE id=?`, [taskId])
    if (!existing) throw new Error('STALE_ID')
    await tx.run(`UPDATE tasks SET status='done', completed_date=?, updated_at=? WHERE id=?`, [
      todayStr,
      now,
      taskId,
    ])
    nextTaskId = await ensureNextOccurrence(tx, taskId)
  })
  if (nextTaskId) {
    const nextRow = await db.get<{ due_date: string }>(`SELECT due_date FROM tasks WHERE id=?`, [
      nextTaskId,
    ])
    broadcast('task-vault:recurrence-spawned', { taskId, nextTaskId, nextDue: nextRow?.due_date })
  }
  indexUpdated()
  return { success: true }
}

/** A finished twin keeps its status; anything else starts open on the new day. */
function twinStatus(status: string): string {
  if (status === 'done' || status === 'cancelled') return status
  return 'open'
}

interface MigrationTarget {
  targetDate: string
  now: string
}

/** Marks a task migrated, pointing its metadata at the twin that replaces it. */
async function markMigrated(db: ExtensionDB, task: MigratingTask, at: MigrationTarget) {
  const twinId = randomUUID()
  const meta = JSON.parse(task.metadata || '{}') as Meta
  meta.migration_twin_id = twinId
  await db.run(
    `UPDATE tasks SET status='migrated', migrated_to=?, metadata=?, updated_at=? WHERE id=?`,
    [at.targetDate, JSON.stringify(meta), at.now, task.id]
  )
  return twinId
}

async function migrateSubtasks(db: ExtensionDB, ids: TwinIds, at: MigrationTarget) {
  const subtasks = await db.query<SubRow>(
    `SELECT id, text, status, sort_order, metadata FROM tasks WHERE parent_id=? ORDER BY sort_order, created_at`,
    [ids.taskId]
  )
  for (const sub of subtasks) {
    const subTwinId = await markMigrated(db, sub, at)
    await insertTask(db, {
      id: subTwinId,
      text: sub.text,
      status: twinStatus(sub.status),
      parentId: ids.newId,
      sortOrder: sub.sort_order ?? 0,
      source: 'daily',
      sourceRef: at.targetDate,
      createdAt: at.now,
      updatedAt: at.now,
    })
  }
}

async function migrateTask({ db }: IpcContext, args: z.infer<typeof MigrateTaskRequestSchema>) {
  const { taskId, targetDate } = args
  const task = await db.get<Record<string, unknown>>(
    `SELECT t.*, t.project_id, t.area_id FROM tasks t WHERE t.id=?`,
    [taskId]
  )
  if (!task) return { error: 'STALE_ID' }
  if ((task.source_ref as string | null) === targetDate) return { newTaskId: taskId, noop: true }
  const at = { targetDate, now: nowIso() }
  const newId = await markMigrated(db, { id: taskId, metadata: task.metadata as string }, at)
  await insertTask(db, {
    id: newId,
    text: task.text as string,
    status: twinStatus(task.status as string),
    projectId: (task.project_id as string) ?? null,
    context: (task.context as string) ?? null,
    areaId: (task.area_id as string) ?? null,
    dueDate: (task.due_date as string) ?? null,
    source: 'daily',
    sourceRef: targetDate,
    createdAt: at.now,
    updatedAt: at.now,
  })
  await migrateSubtasks(db, { taskId, newId }, at)
  indexUpdated()
  return { newTaskId: newId }
}

async function deleteTaskRow({ db }: IpcContext, args: z.infer<typeof DeleteTaskRequestSchema>) {
  if (!(await taskExists(db, args.taskId))) return { error: 'STALE_ID' }
  await deleteTaskTree(db, args.taskId)
  indexUpdated()
  return { success: true }
}

async function cancelTask({ db }: IpcContext, args: z.infer<typeof CancelTaskRequestSchema>) {
  const { taskId } = args
  const now = nowIso()
  if (!(await taskExists(db, taskId))) return { error: 'STALE_ID' }
  await db.run(`UPDATE tasks SET status='cancelled', updated_at=? WHERE id=?`, [now, taskId])
  indexUpdated()
  return { success: true }
}

/** Undoes a migration: drops the twin (and its subtasks), reopens migrated subtasks, and returns
 *  the metadata without the twin pointer, or null for an unknown task. */
async function dropMigrationTwin(db: ExtensionDB, taskId: string, now: string) {
  const meta = await readTaskMeta(db, taskId)
  if (!meta) return null
  const twinId = meta.migration_twin_id as string | undefined
  if (twinId) {
    await db.run(`DELETE FROM tasks WHERE parent_id=?`, [twinId])
    await db.run(`DELETE FROM tasks WHERE id=?`, [twinId])
    delete meta.migration_twin_id
  }
  await db.run(
    `UPDATE tasks SET status='open', migrated_to=NULL, metadata=json_remove(metadata, '$.migration_twin_id'), updated_at=? WHERE parent_id=? AND status='migrated'`,
    [now, taskId]
  )
  return meta
}

async function reopenArchivedTask(
  { db }: IpcContext,
  args: z.infer<typeof RestoreTaskRequestSchema>
) {
  const { taskId } = args
  const now = nowIso()
  const meta = await dropMigrationTwin(db, taskId, now)
  if (!meta) return { error: 'STALE_ID' }
  await db.run(
    `UPDATE tasks SET status='open', source='daily', source_ref=?, completed_date=NULL, migrated_to=NULL, metadata=?, updated_at=? WHERE id=?`,
    [today(), JSON.stringify(meta), now, taskId]
  )
  indexUpdated()
  return { success: true }
}

async function reopenTask({ db }: IpcContext, args: z.infer<typeof RestoreTaskRequestSchema>) {
  const { taskId } = args
  const now = nowIso()
  const meta = await dropMigrationTwin(db, taskId, now)
  if (!meta) return { error: 'STALE_ID' }
  await db.run(
    `UPDATE tasks SET status='open', completed_date=NULL, migrated_to=NULL, metadata=?, updated_at=? WHERE id=?`,
    [JSON.stringify(meta), now, taskId]
  )
  indexUpdated()
  return { success: true }
}

async function blockTask({ db }: IpcContext, args: z.infer<typeof BlockTaskRequestSchema>) {
  const { taskId, reason, checkInterval } = args
  const now = nowIso()
  const meta = await readTaskMeta<Record<string, string>>(db, taskId)
  if (!meta) return { error: 'STALE_ID' }
  meta.blocked_reason = reason
  meta.blocked_check_interval = checkInterval
  await db.run(
    `UPDATE tasks SET status='blocked', metadata=?, blocked_reason=?, blocked_check_interval=?, updated_at=? WHERE id=?`,
    [JSON.stringify(meta), reason, checkInterval, now, taskId]
  )
  triggerSchedulerTick()
  indexUpdated()
  return { success: true }
}

async function unblockTask({ db }: IpcContext, args: TaskId) {
  const { taskId } = args
  const now = nowIso()
  const meta = await readTaskMeta(db, taskId)
  if (!meta) return { error: 'STALE_ID' }
  delete meta.blocked_reason
  delete meta.blocked_check_interval
  await db.run(
    `UPDATE tasks SET status='open', metadata=?, blocked_reason=NULL, blocked_check_interval=NULL, updated_at=? WHERE id=?`,
    [JSON.stringify(meta), now, taskId]
  )
  indexUpdated()
  return { success: true }
}

async function reorderTasks({ db }: IpcContext, args: z.infer<typeof ReorderTasksRequestSchema>) {
  const { orderedIds } = args
  const now = nowIso()
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.run(`UPDATE tasks SET sort_order=?, updated_at=? WHERE id=?`, [
        i,
        now,
        orderedIds[i],
      ])
    }
  })
  indexUpdated()
  return { success: true }
}

function getTaskDetail({ db }: IpcContext, args: TaskId) {
  return orErrorString(async () => {
    const meta = await readTaskMeta<Record<string, string>>(db, args.taskId)
    if (!meta) return { error: 'Task not found' }
    return {
      description: meta.description ?? '',
      acceptanceCriteria: meta.acceptance_criteria ?? '',
      devHints: meta.dev_hints ?? '',
    }
  })
}

function saveTaskDetail({ db }: IpcContext, args: z.infer<typeof SaveTaskDetailRequestSchema>) {
  const { taskId, description, acceptanceCriteria, devHints } = args
  return orErrorString(async () => {
    const meta = await readTaskMeta<Record<string, string>>(db, taskId)
    if (!meta) return { error: 'Task not found' }
    meta.description = description
    meta.acceptance_criteria = acceptanceCriteria
    meta.dev_hints = devHints
    await db.run(`UPDATE tasks SET metadata=?, updated_at=? WHERE id=?`, [
      JSON.stringify(meta),
      nowIso(),
      taskId,
    ])
    return { ok: true }
  })
}

/** Channels that move a single task through its lifecycle. */
export const TASK_STATE_ROUTES = [
  route('task-vault:vault:complete-task', CompleteTaskRequestSchema, completeTask),
  route('task-vault:vault:migrate-task', MigrateTaskRequestSchema, migrateTask),
  route('task-vault:vault:delete-task', DeleteTaskRequestSchema, deleteTaskRow),
  route('task-vault:vault:cancel-task', CancelTaskRequestSchema, cancelTask),
  route('task-vault:vault:restore-task', RestoreTaskRequestSchema, reopenArchivedTask),
  route('task-vault:vault:reopen-task', RestoreTaskRequestSchema, reopenTask),
  route('task-vault:vault:block-task', BlockTaskRequestSchema, blockTask),
  route('task-vault:vault:unblock-task', UnblockTaskRequestSchema, unblockTask),
  route('task-vault:vault:reorder-tasks', ReorderTasksRequestSchema, reorderTasks),
  route('task-vault:vault:get-task-detail', GetTaskDetailRequestSchema, getTaskDetail),
  route('task-vault:vault:save-task-detail', SaveTaskDetailRequestSchema, saveTaskDetail),
]
