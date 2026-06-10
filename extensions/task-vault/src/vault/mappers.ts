/**
 * Shared row-to-domain mappers and SQL fragments used by all IPC modules.
 * Previously each module contained its own duplicate copies.
 */
import type { IndexedTask, IndexedProject, TaskStatus, ProjectStatus } from './types'

export function rowToTask(row: Record<string, unknown>): IndexedTask {
  const source = row.source as string
  const sourceRef = row.source_ref as string | null
  const filePath = sourceRef ? `${source}/${sourceRef}` : source

  // Read promoted columns first; fall back to metadata JSON for legacy rows
  let blockedReason: string | undefined
  let blockedCheckInterval: string | undefined
  let recurrenceEndType: 'none' | 'on_date' | 'after_count' | undefined
  let recurrenceEndDate: string | undefined
  let recurrenceEndCount: number | undefined
  let recurrenceCompletedCount: number | undefined

  // Read from promoted SQL columns (added in migration)
  if (row.blocked_reason != null) {
    blockedReason = (row.blocked_reason as string) || undefined
  }
  if (row.blocked_check_interval != null) {
    blockedCheckInterval = (row.blocked_check_interval as string) || undefined
  }
  if (row.recurrence_end_type != null) {
    recurrenceEndType = (row.recurrence_end_type as 'none' | 'on_date' | 'after_count') || undefined
  }
  if (row.recurrence_end_date != null) {
    recurrenceEndDate = (row.recurrence_end_date as string) || undefined
  }
  if (row.recurrence_end_count != null) {
    recurrenceEndCount = row.recurrence_end_count as number
  }
  if (row.recurrence_completed_count != null) {
    recurrenceCompletedCount = row.recurrence_completed_count as number
  }

  // Fall back to metadata JSON for any fields not yet in columns
  if (
    blockedReason === undefined &&
    blockedCheckInterval === undefined &&
    recurrenceEndType === undefined
  ) {
    try {
      const meta = JSON.parse((row.metadata as string) || '{}') as Record<string, unknown>
      if (blockedReason === undefined) {
        blockedReason = (meta.blocked_reason as string) || undefined
      }
      if (blockedCheckInterval === undefined) {
        blockedCheckInterval = (meta.blocked_check_interval as string) || undefined
      }
      if (recurrenceEndType === undefined) {
        recurrenceEndType =
          (meta.recurrence_end_type as 'none' | 'on_date' | 'after_count') || undefined
      }
      if (recurrenceEndDate === undefined) {
        recurrenceEndDate = (meta.recurrence_end_date as string) || undefined
      }
      if (recurrenceEndCount === undefined) {
        recurrenceEndCount =
          meta.recurrence_end_count != null ? (meta.recurrence_end_count as number) : undefined
      }
      if (recurrenceCompletedCount === undefined) {
        recurrenceCompletedCount =
          meta.recurrence_completed_count != null
            ? (meta.recurrence_completed_count as number)
            : undefined
      }
    } catch {
      // ignore malformed metadata
    }
  }

  // Parse recurrence fields from first-class columns
  const recurrenceRule = (row.recurrence_rule as string) || undefined
  const recurrenceTemplateId = (row.recurrence_template_id as string) || undefined
  const recurrenceNotifyAt = (row.recurrence_notify_at as string) || undefined

  return {
    id: row.id as string,
    filePath,
    line: 0,
    status: row.status as TaskStatus,
    text: row.text as string,
    project: (row.project as string) || undefined,
    context: (row.context as string) || undefined,
    area: (row.area as string) || undefined,
    dueDate: (row.due_date as string) || undefined,
    terminatorLinks: JSON.parse((row.terminator_links as string) || '[]'),
    subtasks: [],
    blockedReason,
    blockedCheckInterval,
    recurrenceRule,
    recurrenceTemplateId,
    recurrenceNotifyAt,
    recurrenceEndType,
    recurrenceEndDate,
    recurrenceEndCount,
    recurrenceCompletedCount,
  }
}

export function rowToProject(row: Record<string, unknown>): IndexedProject {
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
  t.recurrence_end_type, t.recurrence_end_date, t.recurrence_end_count, t.recurrence_completed_count
`

/** JOIN fragment for tasks (aliases p=projects, a=areas) */
export const TASK_JOINS = `LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN areas a ON t.area_id = a.id`

/** Columns to SELECT for a project row */
export const PROJECT_COLS = `p.id, p.name, p.status, ar.name AS area, p.deadline, p.outcome, p.terminator_links, p.created_at, p.updated_at`

/** JOIN fragment for projects (aliases ar=areas) */
export const PROJECT_JOINS = `LEFT JOIN areas ar ON p.area_id = ar.id`
