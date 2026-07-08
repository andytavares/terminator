export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type RecurrenceRule =
  | { kind: 'daily' }
  | { kind: 'biweekly' }
  | { kind: 'monthly' }
  | { kind: 'weekly'; days: number[] } // days: 0=Sun … 6=Sat; empty = every 7 days

export class InvalidRecurrenceRuleError extends Error {
  constructor(raw: string) {
    super(`Invalid recurrence rule: "${raw}"`)
    this.name = 'InvalidRecurrenceRuleError'
  }
}

/** Parse a column rule string into a typed RecurrenceRule. Throws on unrecognised input. */
export function parseRecurrenceRule(raw: string): RecurrenceRule {
  if (raw === 'daily') return { kind: 'daily' }
  if (raw === 'biweekly') return { kind: 'biweekly' }
  if (raw === 'monthly') return { kind: 'monthly' }
  if (raw === 'weekly') return { kind: 'weekly', days: [] }
  if (raw.startsWith('weekly:')) {
    const dayStr = raw.slice('weekly:'.length)
    const days = dayStr
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 0 && n <= 6)
    return { kind: 'weekly', days }
  }
  // Legacy bare interval strings without days — treat as plain weekly
  if (raw === 'weekly') return { kind: 'weekly', days: [] }
  throw new InvalidRecurrenceRuleError(raw)
}

/** Serialise a RecurrenceRule back to its column string representation. */
export function serializeRecurrenceRule(rule: RecurrenceRule): string {
  if (rule.kind === 'weekly') {
    return rule.days.length > 0 ? `weekly:${rule.days.sort((a, b) => a - b).join(',')}` : 'weekly'
  }
  return rule.kind
}

/** Compute the next due date after fromDate using strict recurrence (next occurrence
 *  is always based on fromDate + interval, never on completion date). */
export function computeNextDueDate(fromDate: string, rule: RecurrenceRule): string {
  // Use noon to avoid DST edge cases
  const d = new Date(`${fromDate}T12:00:00`)
  switch (rule.kind) {
    case 'daily':
      d.setDate(d.getDate() + 1)
      break
    case 'biweekly':
      d.setDate(d.getDate() + 14)
      break
    case 'monthly':
      // Intentional overflow: Jan 31 + 1 month = Mar 2 (documented accepted behaviour)
      d.setMonth(d.getMonth() + 1)
      break
    case 'weekly': {
      const days = rule.days
      if (days.length === 0) {
        d.setDate(d.getDate() + 7)
      } else {
        const todayDow = d.getDay()
        const sortedDays = [...days].sort((a, b) => a - b)
        let found = false
        for (const day of sortedDays) {
          if (day > todayDow) {
            d.setDate(d.getDate() + (day - todayDow))
            found = true
            break
          }
        }
        if (!found) {
          d.setDate(d.getDate() + (7 - todayDow + sortedDays[0]))
        }
      }
      break
    }
  }
  return localDate(d)
}

// ─── Recurrence end-condition decoding ───────────────────────────────────────

export type RecurrenceEndType = 'none' | 'on_date' | 'after_count'

export interface RecurrenceEndMeta {
  endType: RecurrenceEndType
  endDate: string | null
  endCount: number | null
  completedCount: number
}

/**
 * Decodes recurrence end-conditions from a legacy metadata JSON blob. This is
 * the ONE place that knows the metadata key names and coercions: SQL columns
 * are authoritative (writers populate them; applyTaskVaultMigrations backfills
 * legacy rows), and this fallback exists only for databases that predate the
 * columns and have not run the migration. Returns null when the blob carries
 * no end-conditions (or is malformed).
 */
export function parseRecurrenceEndMeta(
  metadata: string | null | undefined
): RecurrenceEndMeta | null {
  if (!metadata || metadata === '{}') return null
  try {
    const meta = JSON.parse(metadata) as Record<string, unknown>
    if (!meta.recurrence_end_type) return null
    return {
      endType: meta.recurrence_end_type as RecurrenceEndType,
      endDate: (meta.recurrence_end_date as string) ?? null,
      endCount: meta.recurrence_end_count != null ? (meta.recurrence_end_count as number) : null,
      completedCount: (meta.recurrence_completed_count as number) || 0,
    }
  } catch {
    return null
  }
}

/**
 * End-conditions for a task row: columns first, metadata fallback when the
 * columns say 'none' (matching the historical read semantics).
 */
export function readRecurrenceEndState(row: {
  recurrence_end_type?: string | null
  recurrence_end_date?: string | null
  recurrence_end_count?: number | null
  recurrence_completed_count?: number | null
  metadata?: string | null
}): RecurrenceEndMeta {
  const fromColumns: RecurrenceEndMeta = {
    endType: (row.recurrence_end_type as RecurrenceEndType) ?? 'none',
    endDate: row.recurrence_end_date ?? null,
    endCount: row.recurrence_end_count ?? null,
    completedCount: row.recurrence_completed_count ?? 0,
  }
  if (fromColumns.endType !== 'none') return fromColumns
  return parseRecurrenceEndMeta(row.metadata) ?? fromColumns
}
