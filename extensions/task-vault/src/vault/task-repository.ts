import type { ExtensionDB } from '../../../../src/main/extensions/api'

/**
 * The one INSERT path for task rows. Eight handlers used to hand-write their
 * own column subsets; a schema change now touches this file, not every
 * call site. Fields not provided fall back to the schema's semantics
 * (NULL, or '{}'/'[]' for the JSON blobs).
 */
export interface NewTaskRow {
  id: string
  text: string
  status: string
  source: string
  createdAt: string
  updatedAt: string
  projectId?: string | null
  context?: string | null
  areaId?: string | null
  dueDate?: string | null
  sourceRef?: string | null
  parentId?: string | null
  sortOrder?: number
  todaySince?: string | null
  completedDate?: string | null
  migratedTo?: string | null
  recurrenceRule?: string | null
  recurrenceTemplateId?: string | null
  recurrenceNotifyAt?: string | null
  recurrenceEndType?: string | null
  recurrenceEndDate?: string | null
  recurrenceEndCount?: number | null
  recurrenceCompletedCount?: number | null
  metadata?: string
  terminatorLinks?: string
}

/** Runs against a db or an open transaction (both expose run()). */
export async function insertTask(
  db: Pick<ExtensionDB, 'run'>,
  row: NewTaskRow,
  opts?: { orIgnore?: boolean }
): Promise<void> {
  await db.run(
    `INSERT INTO tasks
       (id, text, status, project_id, context, area_id, due_date, completed_date, migrated_to,
        source, source_ref, parent_id, sort_order, today_since,
        recurrence_rule, recurrence_template_id, recurrence_notify_at,
        recurrence_end_type, recurrence_end_date, recurrence_end_count, recurrence_completed_count,
        metadata, terminator_links, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)${opts?.orIgnore ? ' ON CONFLICT DO NOTHING' : ''}`,
    [
      row.id,
      row.text,
      row.status,
      row.projectId ?? null,
      row.context ?? null,
      row.areaId ?? null,
      row.dueDate ?? null,
      row.completedDate ?? null,
      row.migratedTo ?? null,
      row.source,
      row.sourceRef ?? null,
      row.parentId ?? null,
      row.sortOrder ?? 0,
      row.todaySince ?? null,
      row.recurrenceRule ?? null,
      row.recurrenceTemplateId ?? null,
      row.recurrenceNotifyAt ?? null,
      row.recurrenceEndType ?? null,
      row.recurrenceEndDate ?? null,
      row.recurrenceEndCount ?? null,
      row.recurrenceCompletedCount ?? null,
      row.metadata ?? '{}',
      row.terminatorLinks ?? '[]',
      row.createdAt,
      row.updatedAt,
    ]
  )
}
