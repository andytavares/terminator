import type { z } from 'zod'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { route, type IpcContext } from './register'
import { ensureNextOccurrence } from '../vault/ensure-next-occurrence'
import { broadcast } from '../notifications/task-scheduler.js'
import { ClearRecurrenceRequestSchema, SetRecurrenceRequestSchema } from '../schemas/vault.schema'
import { indexUpdated, nowIso, parseMetaLenient, readTaskMetaLenient, today } from './vault-shared'

type SetArgs = z.infer<typeof SetRecurrenceRequestSchema>
type Meta = Record<string, unknown>

/** Metadata keys the old metadata-based recurrence used; the columns replace them. */
const LEGACY_RECURRENCE_KEYS = [
  'recurrence_interval',
  'recurrence_days',
  'recurrence_time',
  'recurrence_next_spawned',
  'notification_notified_date',
]

/** Every recurrence key a cleared task drops from its metadata. */
const ALL_RECURRENCE_KEYS = [
  ...LEGACY_RECURRENCE_KEYS,
  'recurrence_end_type',
  'recurrence_end_date',
  'recurrence_end_count',
  'recurrence_completed_count',
]

function dropKeys(meta: Meta, keys: string[]): void {
  for (const key of keys) delete meta[key]
}

/** The stored rule: the interval, with sorted weekdays for a weekly rule that names them. */
function recurrenceRule({ interval, days }: SetArgs): string {
  if (interval === 'weekly' && days != null && days.length > 0) {
    return `weekly:${[...days].sort((a, b) => a - b).join(',')}`
  }
  return interval
}

/** The end condition as columns: [type, date, count]. */
function endColumns(args: SetArgs): unknown[] {
  const columns: unknown[] = [args.endType ?? 'none', null, null]
  if (args.endType === 'on_date') columns[1] = args.endDate ?? null
  if (args.endType === 'after_count') columns[2] = args.endCount ?? null
  return columns
}

function withEndMeta(meta: Meta, args: SetArgs): Meta {
  const { endType, endDate, endCount } = args
  meta.recurrence_end_type = endType ?? 'none'
  meta.recurrence_end_date = endType === 'on_date' ? endDate : undefined
  meta.recurrence_end_count = endType === 'after_count' ? endCount : undefined
  meta.recurrence_completed_count = 0
  dropKeys(meta, LEGACY_RECURRENCE_KEYS)
  return meta
}

/** Drops future open occurrences, stores the new rule, and spawns the next occurrence. */
async function applyRecurrence(tx: ExtensionDB, taskId: string, values: unknown[]) {
  await tx.run(
    `DELETE FROM tasks WHERE recurrence_template_id=? AND status='open' AND due_date > ?`,
    [taskId, today()]
  )
  await tx.run(
    `UPDATE tasks SET recurrence_rule=?, recurrence_notify_at=?, due_date=?, metadata=?,
            recurrence_end_type=?, recurrence_end_date=?, recurrence_end_count=?,
            recurrence_completed_count=0,
            updated_at=? WHERE id=?`,
    values
  )
  return ensureNextOccurrence(tx, taskId)
}

async function storeRecurrence({ db }: IpcContext, args: SetArgs) {
  const { taskId, time } = args
  const task = await db.get<{
    metadata: string
    due_date: string | null
    source_ref: string | null
  }>(`SELECT metadata, due_date, source_ref FROM tasks WHERE id=?`, [taskId])
  if (!task) return { error: 'STALE_ID' }
  const meta = withEndMeta(parseMetaLenient(task.metadata), args)
  const values = [
    recurrenceRule(args),
    time ?? null,
    task.due_date ?? task.source_ref ?? today(),
    JSON.stringify(meta),
    ...endColumns(args),
    nowIso(),
    taskId,
  ]
  let nextTaskId: string | null = null
  await db.transaction(async (tx) => {
    nextTaskId = await applyRecurrence(tx, taskId, values)
  })
  if (nextTaskId) broadcast('task-vault:recurrence-spawned', { taskId, nextTaskId })
  indexUpdated()
  return { success: true }
}

async function clearRecurrence(
  { db }: IpcContext,
  args: z.infer<typeof ClearRecurrenceRequestSchema>
) {
  const { taskId } = args
  const meta = await readTaskMetaLenient(db, taskId)
  if (!meta) return { error: 'STALE_ID' }
  dropKeys(meta, ALL_RECURRENCE_KEYS)
  const now = nowIso()
  await db.transaction(async (tx) => {
    await tx.run(`DELETE FROM tasks WHERE recurrence_template_id=? AND status='open'`, [taskId])
    await tx.run(
      `UPDATE tasks SET recurrence_rule=NULL, recurrence_notify_at=NULL,
          recurrence_end_type=NULL, recurrence_end_date=NULL, recurrence_end_count=NULL,
          recurrence_completed_count=NULL, metadata=?, updated_at=? WHERE id=?`,
      [JSON.stringify(meta), now, taskId]
    )
  })
  indexUpdated()
  return { success: true }
}

/** Channels that make a task repeat, or stop it repeating. */
export const RECURRENCE_ROUTES = [
  route('task-vault:vault:set-recurrence', SetRecurrenceRequestSchema, storeRecurrence),
  route('task-vault:vault:clear-recurrence', ClearRecurrenceRequestSchema, clearRecurrence),
]
