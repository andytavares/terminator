import { randomUUID } from 'node:crypto'
import type { ExtensionDB } from '../../../../src/main/extensions/api'
import {
  localDate,
  computeNextDueDate,
  parseRecurrenceRule,
  readRecurrenceEndState,
} from './recurrence'
import { insertTask } from './task-repository'

type TaskRow = {
  id: string
  text: string
  status: string
  project_id: string | null
  context: string | null
  area_id: string | null
  due_date: string | null
  source: string
  source_ref: string | null
  recurrence_rule: string | null
  recurrence_template_id: string | null
  recurrence_notify_at: string | null
  metadata: string
  recurrence_end_type: string | null
  recurrence_end_date: string | null
  recurrence_end_count: number | null
  recurrence_completed_count: number | null
}

export async function ensureNextOccurrence(
  db: ExtensionDB,
  taskId: string
): Promise<string | null> {
  const task = await db.get<TaskRow>(
    `SELECT id, text, status, project_id, context, area_id, due_date, source, source_ref,
            recurrence_rule, recurrence_template_id, recurrence_notify_at, metadata,
            recurrence_end_type, recurrence_end_date, recurrence_end_count,
            recurrence_completed_count
     FROM tasks WHERE id=?`,
    [taskId]
  )

  if (!task || !task.recurrence_rule || !task.due_date) return null

  const templateId = task.recurrence_template_id ?? task.id
  const today = localDate()

  const existing = await db.get<{ id: string }>(
    `SELECT id FROM tasks WHERE recurrence_template_id=? AND status='open' AND due_date >= ?`,
    [templateId, today]
  )

  if (existing) return null

  const rule = parseRecurrenceRule(task.recurrence_rule)
  const nextDue = computeNextDueDate(task.due_date, rule)

  const {
    endType,
    endDate: endDateCol,
    endCount: endCountCol,
    completedCount: spawnCount,
  } = readRecurrenceEndState(task)

  if (endType === 'on_date') {
    if (endDateCol && nextDue > endDateCol) return null
  } else if (endType === 'after_count') {
    if (endCountCol != null && spawnCount + 1 >= endCountCol) return null
  }

  const newId = randomUUID()
  const nowIso = new Date().toISOString()

  await db.transaction(async (tx) => {
    await insertTask(tx, {
      id: newId,
      text: task.text,
      status: 'open',
      projectId: task.project_id,
      context: task.context,
      areaId: task.area_id,
      dueDate: nextDue,
      source: task.source,
      sourceRef: task.source === 'daily' ? nextDue : task.source_ref,
      recurrenceRule: task.recurrence_rule,
      recurrenceTemplateId: templateId,
      recurrenceNotifyAt: task.recurrence_notify_at,
      recurrenceEndType: endType !== 'none' ? endType : null,
      recurrenceEndDate: endDateCol,
      recurrenceEndCount: endCountCol,
      recurrenceCompletedCount: spawnCount + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
  })

  return newId
}

export async function backfillRecurringTasks(db: ExtensionDB): Promise<void> {
  const today = localDate()

  type TemplateRow = { id: string }
  const templates = await db.query<TemplateRow>(
    `SELECT t.id FROM tasks t
     WHERE t.recurrence_rule IS NOT NULL
       AND t.recurrence_template_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM tasks i
         WHERE i.recurrence_template_id = t.id
           AND i.status = 'open'
           AND i.due_date >= ?
       )`,
    [today]
  )

  for (const { id } of templates) {
    try {
      await ensureNextOccurrence(db, id)
    } catch {
      // Skip tasks with invalid recurrence rules rather than crashing startup
    }
  }

  const selfContained = await db.query<TemplateRow>(
    `SELECT id FROM tasks
     WHERE recurrence_rule IS NOT NULL
       AND recurrence_template_id IS NULL
       AND due_date IS NOT NULL
       AND due_date < ?
       AND status = 'open'`,
    [today]
  )

  for (const { id } of selfContained) {
    try {
      await ensureNextOccurrence(db, id)
    } catch {
      // Skip invalid rules
    }
  }
}
