import { randomUUID } from 'node:crypto'
import type { ExtensionDB } from '@terminator/extension-sdk'
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

type EndState = ReturnType<typeof readRecurrenceEndState>

/** Whether the series has ended before an occurrence due on `nextDue`. */
function seriesEnded(end: EndState, nextDue: string): boolean {
  if (end.endType === 'on_date') return Boolean(end.endDate && nextDue > end.endDate)
  if (end.endType === 'after_count') {
    return end.endCount != null && end.completedCount + 1 >= end.endCount
  }
  return false
}

async function loadTask(db: ExtensionDB, taskId: string): Promise<TaskRow | undefined> {
  return db.get<TaskRow>(
    `SELECT id, text, status, project_id, context, area_id, due_date, source, source_ref,
            recurrence_rule, recurrence_template_id, recurrence_notify_at, metadata,
            recurrence_end_type, recurrence_end_date, recurrence_end_count,
            recurrence_completed_count
     FROM tasks WHERE id=?`,
    [taskId]
  )
}

async function hasUpcomingOccurrence(db: ExtensionDB, templateId: string): Promise<boolean> {
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM tasks WHERE recurrence_template_id=? AND status='open' AND due_date >= ?`,
    [templateId, localDate()]
  )
  return Boolean(existing)
}

interface Occurrence {
  templateId: string
  nextDue: string
  end: EndState
}

/** Inserts the next occurrence of `task`; returns its id. */
async function spawnOccurrence(db: ExtensionDB, task: TaskRow, next: Occurrence): Promise<string> {
  const { templateId, nextDue, end } = next
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
      recurrenceEndType: end.endType !== 'none' ? end.endType : null,
      recurrenceEndDate: end.endDate,
      recurrenceEndCount: end.endCount,
      recurrenceCompletedCount: end.completedCount + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
  })
  return newId
}

export async function ensureNextOccurrence(
  db: ExtensionDB,
  taskId: string
): Promise<string | null> {
  const task = await loadTask(db, taskId)
  if (!task || !task.recurrence_rule || !task.due_date) return null
  const templateId = task.recurrence_template_id ?? task.id
  if (await hasUpcomingOccurrence(db, templateId)) return null
  const nextDue = computeNextDueDate(task.due_date, parseRecurrenceRule(task.recurrence_rule))
  const end = readRecurrenceEndState(task)
  if (seriesEnded(end, nextDue)) return null
  return spawnOccurrence(db, task, { templateId, nextDue, end })
}

/** Ensures each listed task has its next occurrence, skipping any with an invalid rule. */
async function ensureEach(db: ExtensionDB, rows: { id: string }[]): Promise<void> {
  for (const { id } of rows) {
    try {
      await ensureNextOccurrence(db, id)
    } catch {
      // Skip tasks with invalid recurrence rules rather than crashing startup
    }
  }
}

export async function backfillRecurringTasks(db: ExtensionDB): Promise<void> {
  const today = localDate()
  const templates = await db.query<{ id: string }>(
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
  await ensureEach(db, templates)
  const selfContained = await db.query<{ id: string }>(
    `SELECT id FROM tasks
     WHERE recurrence_rule IS NOT NULL
       AND recurrence_template_id IS NULL
       AND due_date IS NOT NULL
       AND due_date < ?
       AND status = 'open'`,
    [today]
  )
  await ensureEach(db, selfContained)
}
