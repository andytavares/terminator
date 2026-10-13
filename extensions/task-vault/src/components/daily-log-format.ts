import type React from 'react'
import type { IndexedTask } from '../vault/types'
import { useVaultNavStore } from '../stores/vault-nav.store'

export type EndType = 'none' | 'on_date' | 'after_count'

/** A recurrence as the dialog edits it. */
export interface RecurrenceDraft {
  interval: string
  days: number[]
  time: string
  endType: EndType
  endDate: string
  endCount: number
}

/** What the dialog starts from when the task already repeats. */
export interface ExistingRecurrence {
  interval: string
  days?: number[]
  time?: string
  endType?: EndType
  endDate?: string
  endCount?: number
}

export const QUICK_INTERVALS: { value: string; label: string }[] = [
  { value: '30-min', label: '30 min' },
  { value: '1-hour', label: '1 hr' },
  { value: '2-hour', label: '2 hrs' },
  { value: '4-hour', label: '4 hrs' },
  { value: '1-day', label: '1 day' },
  { value: '2-day', label: '2 days' },
  { value: '1-week', label: '1 week' },
  { value: '2-weeks', label: '2 weeks' },
  { value: '1-month', label: '1 month' },
]

export const INTERVAL_LABELS: Record<string, string> = Object.fromEntries(
  QUICK_INTERVALS.map(({ value, label }) => [value, label])
)

export const WEEKDAY_LABELS: { value: number; short: string }[] = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
]

export const RECURRENCE_INTERVALS: { value: string; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
]

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** A local date as YYYY-MM-DD. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The date shares the weekday's line and carries the weight: you navigate by the date, and you
 *  know what day it is (the weekday was once ~48px with the date small beneath it). */
export function formatDate(iso: string): { weekday: string; detail: string } {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return {
    weekday: dt.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
    detail: dt.toLocaleDateString('en-US', { year: 'numeric' }),
  }
}

export function formatCheckInterval(value: string): string {
  if (INTERVAL_LABELS[value]) return INTERVAL_LABELS[value]
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

/** Today, the earliest day a custom check-in can fall on. */
export function localDateMin(): string {
  return ymd(new Date())
}

/** Tomorrow, where a custom check-in starts. */
export function defaultCustomDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return ymd(d)
}

function hour12(hour: number): number {
  const h = hour % 12
  if (h === 0) return 12
  return h
}

function meridiem(hour: number): string {
  if (hour < 12) return 'AM'
  return 'PM'
}

function format12h(hhmm: string): string {
  const parts = hhmm.split(':')
  const h = parseInt(parts[0] ?? '0', 10)
  const mStr = parts[1] ?? '00'
  return `${hour12(h)}:${mStr} ${meridiem(h)}`
}

/** The weekday numbers of a 'weekly:1,3' rule. */
function weeklyDays(rule: string): number[] {
  return rule
    .slice('weekly:'.length)
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n))
}

function intervalLabel(value: string): string | undefined {
  return RECURRENCE_INTERVALS.find((r) => r.value === value)?.label
}

/** Weekday names in Monday-first order. */
function weekdayNames(days: number[]): string {
  return days
    .slice()
    .sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
    .map((d) => WEEKDAY_LABELS.find((w) => w.value === d)?.short ?? d)
    .join(', ')
}

/** Format a recurrence_rule column value (e.g. 'weekly:1,3') for display. */
export function formatRecurrenceRule(rule: string): string {
  if (!rule.startsWith('weekly:')) return intervalLabel(rule) ?? rule
  const weeklyLabel = intervalLabel('weekly') ?? 'Weekly'
  const dayLabels = weekdayNames(weeklyDays(rule))
  if (!dayLabels) return weeklyLabel
  return `${weeklyLabel} · ${dayLabels}`
}

/** The rule a saved draft amounts to, for the confirmation. */
export function draftRule(draft: RecurrenceDraft): string {
  if (draft.days.length === 0) return draft.interval
  return `weekly:${[...draft.days].sort((a, b) => a - b).join(',')}`
}

/** The task's recurrence as the dialog starts from it, if it repeats. */
export function existingRecurrence(task: IndexedTask): ExistingRecurrence | undefined {
  const rule = task.recurrenceRule
  if (!rule) return undefined
  const weekly = rule.startsWith('weekly:')
  return {
    interval: weekly ? 'weekly' : rule,
    days: weekly ? weeklyDays(rule) : undefined,
    time: task.recurrenceNotifyAt,
    endType: task.recurrenceEndType,
    endDate: task.recurrenceEndDate,
    endCount: task.recurrenceEndCount,
  }
}

/** The badge title: the rule, and the time it notifies at. */
export function recurrenceTitle(task: IndexedTask): string {
  const repeats = `Repeats: ${formatRecurrenceRule(task.recurrenceRule ?? '')}`
  if (!task.recurrenceNotifyAt) return repeats
  return `${repeats} at ${format12h(task.recurrenceNotifyAt)}`
}

/** The task as typed: its text with its tags, so an edit starts from all of it. */
export function rawTaskText(task: IndexedTask): string {
  const parts = [task.text]
  if (task.project) parts.push(`@${task.project.replace(/ /g, '-')}`)
  if (task.context) parts.push(`+${task.context.replace(/ /g, '-')}`)
  if (task.area) parts.push(`#${task.area.replace(/ /g, '-')}`)
  if (task.dueDate) parts.push(`due:${task.dueDate}`)
  return parts.join(' ')
}

/** Whether a task has sat on today's list for the threshold's days or more. */
export function isStaleSince(todaySince: string | undefined, thresholdDays?: number): boolean {
  if (!thresholdDays || !todaySince) return false
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - thresholdDays)
  return todaySince <= ymd(cutoff)
}

/** Leads back to the task, already inside the vault view. (A tab activation once here reached a
 *  copy of the core registry bundled into this view and moved nothing.) */
export function makeTaskNavHandler(taskId: string): () => void {
  return () => useVaultNavStore.getState().navigateToTask(taskId)
}

/** Calls one of the vault's channels. */
export function invokeVault(channel: string, payload: unknown): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

/** The fields that hold a value, so defaults can fill in the rest. */
export function definedFields<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null)) as Partial<T>
}

/** A handler bound to one id, or nothing when there is no handler. */
export function bindId(handler: ((id: string) => void) | undefined, id: string) {
  return handler && (() => handler(id))
}

/** A pointer cursor over something clickable. */
export function pointerWhen(clickable: unknown): React.CSSProperties {
  if (!clickable) return { cursor: undefined }
  return { cursor: 'pointer' }
}

/** The modifier class a flag adds, or nothing. */
export function modifier(on: unknown, className: string): string {
  return on ? ` ${className}` : ''
}
