import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { localDate, computeNextDueDate, parseRecurrenceRule } from './recurrence'

type TaskRow = {
  id: string
  text: string
  status: string
  project_id: string | null
  context: string | null
  area_id: string | null
  due_date: string | null
  source: string
  recurrence_rule: string | null
  recurrence_template_id: string | null
  recurrence_notify_at: string | null
  metadata: string
}

/**
 * Enforce the invariant: for any recurring task, exactly one status='open' future
 * instance exists in the database. If one already exists, does nothing (idempotent).
 * If none exists and end conditions allow, inserts the next occurrence atomically.
 *
 * Returns the new task ID if an occurrence was created, null otherwise.
 */
export function ensureNextOccurrence(db: Database.Database, taskId: string): string | null {
  const task = db
    .prepare(
      `SELECT id, text, status, project_id, context, area_id, due_date, source,
              recurrence_rule, recurrence_template_id, recurrence_notify_at, metadata
       FROM tasks WHERE id=?`
    )
    .get(taskId) as TaskRow | undefined

  if (!task || !task.recurrence_rule || !task.due_date) return null

  // Resolve the canonical template ID: if this task is already an instance, use its
  // template; otherwise this task IS the template.
  const templateId = task.recurrence_template_id ?? task.id

  const today = localDate()

  // Check if a future open instance already exists
  const existing = db
    .prepare(
      `SELECT id FROM tasks
       WHERE recurrence_template_id=? AND status='open' AND due_date >= ?`
    )
    .get(templateId, today) as { id: string } | undefined

  if (existing) return null // invariant already satisfied

  // Parse the rule (throws InvalidRecurrenceRuleError on unknown intervals)
  const rule = parseRecurrenceRule(task.recurrence_rule)

  // Compute next due date from the most recent instance's due date (strict mode)
  const nextDue = computeNextDueDate(task.due_date, rule)

  // Read end conditions from metadata
  let meta: Record<string, unknown> = {}
  try {
    meta = JSON.parse(task.metadata || '{}') as Record<string, unknown>
  } catch {
    // malformed metadata — treat as no end conditions
  }

  const endType = (meta.recurrence_end_type as string) || 'none'
  const spawnCount = (meta.recurrence_completed_count as number) || 0

  if (endType === 'on_date') {
    const endDate = meta.recurrence_end_date as string | undefined
    if (endDate && nextDue > endDate) return null
  } else if (endType === 'after_count') {
    const endCount = meta.recurrence_end_count as number | undefined
    // Replicate existing boundary: spawnCount + 1 >= endCount means exhausted
    if (endCount != null && spawnCount + 1 >= endCount) return null
  }

  const newId = randomUUID()
  const nowIso = new Date().toISOString()

  // Carry forward the end configuration; bump completed count
  const nextMeta: Record<string, unknown> = {}
  if (endType !== 'none') nextMeta.recurrence_end_type = endType
  if (meta.recurrence_end_date) nextMeta.recurrence_end_date = meta.recurrence_end_date
  if (meta.recurrence_end_count != null) nextMeta.recurrence_end_count = meta.recurrence_end_count
  nextMeta.recurrence_completed_count = spawnCount + 1

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks
         (id, text, status, project_id, context, area_id, due_date,
          source, source_ref, recurrence_rule, recurrence_template_id,
          recurrence_notify_at, metadata, terminator_links, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId,
      task.text,
      'open',
      task.project_id ?? null,
      task.context ?? null,
      task.area_id ?? null,
      nextDue,
      'daily',
      nextDue,
      task.recurrence_rule,
      templateId,
      task.recurrence_notify_at ?? null,
      JSON.stringify(nextMeta),
      '[]',
      nowIso,
      nowIso
    )
  })

  insert()
  return newId
}

/**
 * On startup, ensure every recurring template task that has no future open instance
 * gets one. Handles the case where the app was closed for one or more days.
 */
export function backfillRecurringTasks(db: Database.Database): void {
  const today = localDate()

  // Find template tasks (those with a recurrence_rule and no recurrence_template_id)
  // whose most recent instance is in the past and has no future open instance.
  type TemplateRow = { id: string }
  const templates = db
    .prepare(
      `SELECT t.id FROM tasks t
       WHERE t.recurrence_rule IS NOT NULL
         AND t.recurrence_template_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM tasks i
           WHERE i.recurrence_template_id = t.id
             AND i.status = 'open'
             AND i.due_date >= ?
         )`
    )
    .all(today) as TemplateRow[]

  for (const { id } of templates) {
    try {
      ensureNextOccurrence(db, id)
    } catch {
      // Skip tasks with invalid recurrence rules rather than crashing startup
    }
  }

  // Also handle self-contained recurring tasks (no instances yet, due in the past)
  const selfContained = db
    .prepare(
      `SELECT id FROM tasks
       WHERE recurrence_rule IS NOT NULL
         AND recurrence_template_id IS NULL
         AND due_date IS NOT NULL
         AND due_date < ?
         AND status = 'open'`
    )
    .all(today) as TemplateRow[]

  for (const { id } of selfContained) {
    try {
      ensureNextOccurrence(db, id)
    } catch {
      // Skip invalid rules
    }
  }
}
