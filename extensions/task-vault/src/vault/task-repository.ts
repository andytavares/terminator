import type { ExtensionDB } from '@terminator/extension-sdk'

/**
 * The one INSERT path for task rows. Eight handlers used to hand-write their
 * own column subsets; a schema change now touches this file, not every
 * call site. Fields not provided fall back to the schema's semantics
 * (NULL, or '{}'/'[]' for the JSON blobs).
 *
 * Assumes applyTaskVaultSchema has run (at extension activation, before any
 * handler can reach this).
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

/** Every column insertTask writes: [column, row field, value when the field is absent]. */
const TASK_INSERT_COLUMNS: [string, keyof NewTaskRow, unknown][] = [
  ['id', 'id', null],
  ['text', 'text', null],
  ['status', 'status', null],
  ['project_id', 'projectId', null],
  ['context', 'context', null],
  ['area_id', 'areaId', null],
  ['due_date', 'dueDate', null],
  ['completed_date', 'completedDate', null],
  ['migrated_to', 'migratedTo', null],
  ['source', 'source', null],
  ['source_ref', 'sourceRef', null],
  ['parent_id', 'parentId', null],
  ['sort_order', 'sortOrder', 0],
  ['today_since', 'todaySince', null],
  ['recurrence_rule', 'recurrenceRule', null],
  ['recurrence_template_id', 'recurrenceTemplateId', null],
  ['recurrence_notify_at', 'recurrenceNotifyAt', null],
  ['recurrence_end_type', 'recurrenceEndType', null],
  ['recurrence_end_date', 'recurrenceEndDate', null],
  ['recurrence_end_count', 'recurrenceEndCount', null],
  ['recurrence_completed_count', 'recurrenceCompletedCount', null],
  ['metadata', 'metadata', '{}'],
  ['terminator_links', 'terminatorLinks', '[]'],
  ['created_at', 'createdAt', null],
  ['updated_at', 'updatedAt', null],
]

const INSERT_SQL = `INSERT INTO tasks (${TASK_INSERT_COLUMNS.map(([c]) => c).join(', ')})
     VALUES (${TASK_INSERT_COLUMNS.map(() => '?').join(',')})`

/** Runs against a db or an open transaction (both expose run()). */
export async function insertTask(
  db: Pick<ExtensionDB, 'run'>,
  row: NewTaskRow,
  opts?: { orIgnore?: boolean }
): Promise<void> {
  const values = TASK_INSERT_COLUMNS.map(([, field, fallback]) => row[field] ?? fallback)
  await db.run(`${INSERT_SQL}${opts?.orIgnore ? ' ON CONFLICT DO NOTHING' : ''}`, values)
}
