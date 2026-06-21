import { randomUUID } from 'node:crypto'
import type { ExtensionDB } from '../../../../src/main/extensions/api'
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

  let endType = task.recurrence_end_type ?? 'none'
  let endDateCol = task.recurrence_end_date ?? null
  let endCountCol = task.recurrence_end_count ?? null
  let spawnCount = task.recurrence_completed_count ?? 0

  if (endType === 'none' && task.metadata && task.metadata !== '{}') {
    try {
      const meta = JSON.parse(task.metadata) as Record<string, unknown>
      if (meta.recurrence_end_type) {
        endType = meta.recurrence_end_type as string
        endDateCol = (meta.recurrence_end_date as string) ?? null
        endCountCol =
          meta.recurrence_end_count != null ? (meta.recurrence_end_count as number) : null
        spawnCount = (meta.recurrence_completed_count as number) || 0
      }
    } catch {
      // malformed metadata — treat as no end conditions
    }
  }

  if (endType === 'on_date') {
    if (endDateCol && nextDue > endDateCol) return null
  } else if (endType === 'after_count') {
    if (endCountCol != null && spawnCount + 1 >= endCountCol) return null
  }

  const newId = randomUUID()
  const nowIso = new Date().toISOString()

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO tasks
         (id, text, status, project_id, context, area_id, due_date,
          source, source_ref, recurrence_rule, recurrence_template_id,
          recurrence_notify_at, metadata, terminator_links, created_at, updated_at,
          recurrence_end_type, recurrence_end_date, recurrence_end_count,
          recurrence_completed_count)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newId,
        task.text,
        'open',
        task.project_id ?? null,
        task.context ?? null,
        task.area_id ?? null,
        nextDue,
        task.source,
        task.source === 'daily' ? nextDue : task.source_ref,
        task.recurrence_rule,
        templateId,
        task.recurrence_notify_at ?? null,
        '{}',
        '[]',
        nowIso,
        nowIso,
        endType !== 'none' ? endType : null,
        endDateCol,
        endCountCol,
        spawnCount + 1,
      ]
    )
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
