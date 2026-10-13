/**
 * Shared row-to-domain mappers and SQL fragments used by all IPC modules.
 * Previously each module contained its own duplicate copies.
 */
import type { IndexedTask, IndexedProject, TaskStatus, ProjectStatus } from './types'
import { readRecurrenceEndState } from './recurrence'

type Row = Record<string, unknown>

interface BlockedFields {
  blockedReason?: string
  blockedCheckInterval?: string
}

interface RecurrenceEndFields {
  recurrenceEndType?: 'none' | 'on_date' | 'after_count'
  recurrenceEndDate?: string
  recurrenceEndCount?: number
  recurrenceCompletedCount?: number
}

/** A text column's value, or undefined when it is null or empty. */
function optional(row: Row, column: string): string | undefined {
  return (row[column] as string) || undefined
}

/** The blocked_* columns, falling back to the metadata JSON for legacy rows. */
function blockedFields(row: Row): BlockedFields {
  const fields: BlockedFields = {}
  if (row.blocked_reason != null) fields.blockedReason = optional(row, 'blocked_reason')
  if (row.blocked_check_interval != null) {
    fields.blockedCheckInterval = optional(row, 'blocked_check_interval')
  }
  if (fields.blockedReason !== undefined || fields.blockedCheckInterval !== undefined) return fields
  try {
    const meta = JSON.parse((row.metadata as string) || '{}') as Row
    return {
      blockedReason: optional(meta, 'blocked_reason'),
      blockedCheckInterval: optional(meta, 'blocked_check_interval'),
    }
  } catch {
    return fields // ignore malformed metadata
  }
}

/** An explicit 'none' column stays an explicit 'none' in the DTO, with any counts it holds. */
function explicitNoEnd(row: Row): RecurrenceEndFields {
  const fields: RecurrenceEndFields = { recurrenceEndType: 'none' }
  if (row.recurrence_end_count != null) {
    fields.recurrenceEndCount = row.recurrence_end_count as number
  }
  if (row.recurrence_completed_count != null) {
    fields.recurrenceCompletedCount = row.recurrence_completed_count as number
  }
  return fields
}

/** Read through the scheduler's own reader (readRecurrenceEndState), so the UI and
 *  ensure-next-occurrence agree on every row, including partly migrated ones whose column says
 *  'none' while the end-conditions still live in the metadata JSON. */
function recurrenceEndFields(row: Row): RecurrenceEndFields {
  const endState = readRecurrenceEndState(row as Parameters<typeof readRecurrenceEndState>[0])
  if (endState.endType !== 'none') {
    return {
      recurrenceEndType: endState.endType,
      recurrenceEndDate: endState.endDate ?? undefined,
      recurrenceEndCount: endState.endCount ?? undefined,
      recurrenceCompletedCount: endState.completedCount,
    }
  }
  if (row.recurrence_end_type != null) return explicitNoEnd(row)
  return {}
}

/** Where the task is filed, as `source/sourceRef` (or just the source). */
function rowFilePath(row: Row): string {
  const source = row.source as string
  const sourceRef = row.source_ref as string | null
  if (sourceRef) return `${source}/${sourceRef}`
  return source
}

export function rowToTask(row: Row): IndexedTask {
  const blocked = blockedFields(row)
  const end = recurrenceEndFields(row)
  return {
    id: row.id as string,
    filePath: rowFilePath(row),
    line: 0,
    status: row.status as TaskStatus,
    text: row.text as string,
    project: optional(row, 'project'),
    context: optional(row, 'context'),
    area: optional(row, 'area'),
    dueDate: optional(row, 'due_date'),
    terminatorLinks: JSON.parse((row.terminator_links as string) || '[]'),
    subtasks: [],
    blockedReason: blocked.blockedReason,
    blockedCheckInterval: blocked.blockedCheckInterval,
    recurrenceRule: optional(row, 'recurrence_rule'),
    recurrenceTemplateId: optional(row, 'recurrence_template_id'),
    recurrenceNotifyAt: optional(row, 'recurrence_notify_at'),
    recurrenceEndType: end.recurrenceEndType,
    recurrenceEndDate: end.recurrenceEndDate,
    recurrenceEndCount: end.recurrenceEndCount,
    recurrenceCompletedCount: end.recurrenceCompletedCount,
    todaySince: optional(row, 'today_since'),
  }
}

export function rowToProject(row: Row): IndexedProject {
  return {
    id: row.id as string,
    filePath: row.name as string, // use name as stable identifier
    name: row.name as string,
    status: row.status as ProjectStatus,
    area: (row.area as string) || undefined,
    deadline: (row.deadline as string) || undefined,
    isStale: false, // filled by caller
    nextActionCount: 0, // filled by caller
    lastModified: row.updated_at as string,
    terminatorLinks: JSON.parse((row.terminator_links as string) || '[]'),
  }
}

/** Columns to SELECT for a task row (used in all IPC modules) */
export const TASK_COLS = `
  t.id, t.text, t.status, p.name AS project, t.context, a.name AS area,
  t.due_date, t.completed_date, t.migrated_to,
  t.terminator_links, t.source, t.source_ref, t.parent_id,
  t.sort_order, t.metadata, t.created_at, t.updated_at,
  t.project_id, t.area_id,
  t.recurrence_rule, t.recurrence_template_id, t.recurrence_notify_at,
  t.blocked_reason, t.blocked_check_interval,
  t.recurrence_end_type, t.recurrence_end_date, t.recurrence_end_count, t.recurrence_completed_count,
  t.today_since
`

/** JOIN fragment for tasks (aliases p=projects, a=areas) */
export const TASK_JOINS = `LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN areas a ON t.area_id = a.id`

/** Columns to SELECT for a project row */
export const PROJECT_COLS = `p.id, p.name, p.status, ar.name AS area, p.deadline, p.outcome, p.terminator_links, p.created_at, p.updated_at`

/** JOIN fragment for projects (aliases ar=areas) */
export const PROJECT_JOINS = `LEFT JOIN areas ar ON p.area_id = ar.id`
