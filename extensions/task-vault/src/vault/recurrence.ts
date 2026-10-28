export type RecurrenceRule =
  | { kind: 'daily' }
  | { kind: 'biweekly' }
  | { kind: 'monthly' }
  | { kind: 'weekly'; days: number[] } // days: 0=Sun … 6=Sat; empty = every 7 days

/** @internal */
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

/** The calendar date a stored due date names, or null: a `due:` tag stores whatever was typed. */
function calendarDate(dueDate: string): Temporal.PlainDate | null {
  try {
    return Temporal.PlainDate.from(dueDate)
  } catch {
    return null
  }
}

/** The next due date after fromDate under strict recurrence (fromDate + interval, never the
 *  completion date), or null when fromDate is not a calendar date. A monthly series falls on
 *  seriesStart's day of the month, the series' first due date. */
export function computeNextDueDate(
  fromDate: string,
  rule: RecurrenceRule,
  seriesStart: string = fromDate
): string | null {
  const from = calendarDate(fromDate)
  if (!from) return null
  if (rule.kind === 'monthly') return nextMonthly(from, calendarDate(seriesStart) ?? from)
  // Temporal counts Monday as 1 and Sunday as 7; a rule's days count Sunday as 0.
  return from.add({ days: daysToNext(rule, from.dayOfWeek % 7) }).toString()
}

/** The month after `from`, on `start`'s day. A day the month lacks becomes its last day: a
 *  series from Jan 31 is due Feb 28, then Mar 31. */
function nextMonthly(from: Temporal.PlainDate, start: Temporal.PlainDate): string {
  return from.add({ months: 1 }).with({ day: start.day }, { overflow: 'constrain' }).toString()
}

/** Days from a date on weekday `dow` to the rule's next occurrence (monthly aside). */
function daysToNext(rule: RecurrenceRule, dow: number): number {
  if (rule.kind === 'daily') return 1
  if (rule.kind === 'biweekly') return 14
  if (rule.kind !== 'weekly' || rule.days.length === 0) return 7
  const sortedDays = [...rule.days].sort((a, b) => a - b)
  const later = sortedDays.find((day) => day > dow)
  if (later !== undefined) return later - dow
  return 7 - dow + sortedDays[0]
}

// ─── Recurrence end-condition decoding ───────────────────────────────────────

type RecurrenceEndType = 'none' | 'on_date' | 'after_count'

export interface RecurrenceEndMeta {
  endType: RecurrenceEndType
  endDate: string | null
  endCount: number | null
  completedCount: number
}

/** The task columns that hold a series' end-conditions. */
export interface RecurrenceEndColumns {
  recurrence_end_type?: string | null
  recurrence_end_date?: string | null
  recurrence_end_count?: number | null
  recurrence_completed_count?: number | null
}

/** End-conditions for a task row, read from its columns. */
export function readRecurrenceEndState(row: RecurrenceEndColumns): RecurrenceEndMeta {
  return {
    endType: (row.recurrence_end_type as RecurrenceEndType) ?? 'none',
    endDate: row.recurrence_end_date ?? null,
    endCount: row.recurrence_end_count ?? null,
    completedCount: row.recurrence_completed_count ?? 0,
  }
}
