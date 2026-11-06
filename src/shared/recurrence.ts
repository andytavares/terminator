// When a Scheduled run repeats: the Repeat rule in local time, shared by main and the renderer.

export type RepeatUnit = 'minute' | 'hour' | 'day' | 'week' | 'month'

export interface RepeatRule {
  /** 1..999 units between runs. */
  every: number
  unit: RepeatUnit
  /** Weekdays it may run on, Sunday = 0; empty means every day. */
  days: number[]
  /** Minute and hour repeats only: the 'HH:MM' window a day's runs stay inside, both ends included. */
  between: { from: string; to: string } | null
  /** What a run does when the previous one still runs. */
  overlap: 'skip' | 'start'
}

/** A rule with the time of day it runs at and the date it counts from. */
export interface RepeatPlan {
  rule: RepeatRule
  /** 'HH:MM', local. */
  time: string
  anchor: Date
}

/** No walk goes further than this many steps (days, weeks or months). */
const MAX_STEPS = 10_000
const MINUTES_PER_DAY = 24 * 60
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const minuteOfDay = (hhmm: string): number => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

const dayAllowed = (rule: RepeatRule, date: Date): boolean =>
  rule.days.length === 0 || rule.days.includes(date.getDay())

/** The runs of one day for a minute or hour repeat; each day restarts at `time`. */
function runsInDay(rule: RepeatRule, time: string, day: Date): Date[] {
  const step = rule.every * (rule.unit === 'hour' ? 60 : 1)
  const from = rule.between === null ? 0 : minuteOfDay(rule.between.from)
  const last = rule.between === null ? MINUTES_PER_DAY - 1 : minuteOfDay(rule.between.to)
  const runs: Date[] = []
  for (let minute = minuteOfDay(time); minute <= last; minute += step) {
    const run = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute)
    // A skipped hour on a spring-forward day folds two slots into one.
    if (minute >= from && run.getTime() !== runs[runs.length - 1]?.getTime()) runs.push(run)
  }
  return runs
}

/** The day, week or month step `index` as local dates, from the anchor. */
function calendarDates(rule: RepeatRule, anchor: Date, index: number): Date[] {
  const [year, month, day] = [anchor.getFullYear(), anchor.getMonth(), anchor.getDate()]
  if (rule.unit === 'day') return [new Date(year, month, day + index * rule.every)]
  if (rule.unit === 'month') {
    const first = new Date(year, month + index * rule.every, 1)
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    return [new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay))]
  }
  const weekStart = day - anchor.getDay() + index * 7 * rule.every
  if (rule.days.length === 0) return [new Date(year, month, day + index * 7 * rule.every)]
  const days = [...rule.days].sort((a, b) => a - b)
  return days
    .map((weekday) => new Date(year, month, weekStart + weekday))
    .filter((date) => date >= startOfDay(anchor))
}

/** Every run from the step that can hold `near`, in order. Bounded by MAX_STEPS. */
function* runsNear(plan: RepeatPlan, near: Date): Generator<Date> {
  const { rule, time, anchor } = plan
  const [hours, minutes] = time.split(':').map(Number)
  const isClock = rule.unit === 'minute' || rule.unit === 'hour'
  const daysToNear = Math.round((startOfDay(near).getTime() - startOfDay(anchor).getTime()) / 864e5)
  // A clock repeat steps by day; start a week early so the days filter never hides the answer.
  const first = isClock ? Math.max(0, daysToNear - 8) : 0
  for (let index = first; index < first + MAX_STEPS; index++) {
    if (isClock) {
      const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + index)
      if (dayAllowed(rule, day)) yield* runsInDay(rule, time, day)
      continue
    }
    for (const date of calendarDates(rule, anchor, index)) {
      if (rule.unit === 'week' || dayAllowed(rule, date))
        yield new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes)
    }
  }
}

/** The next `count` runs after `after`. */
export function nextRuns(plan: RepeatPlan, after: Date, count: number): Date[] {
  const found: Date[] = []
  for (const run of runsNear(plan, after)) {
    if (run > after) found.push(run)
    if (found.length >= count) break
  }
  return found
}

/** The latest run at or before `atOrBefore`, or null when none came yet. */
export function latestRun(plan: RepeatPlan, atOrBefore: Date): Date | null {
  let latest: Date | null = null
  for (const run of runsNear(plan, atOrBefore)) {
    if (run > atOrBefore) break
    latest = run
  }
  return latest
}

const isWeekdays = (rule: RepeatRule): boolean =>
  rule.unit === 'day' && rule.every === 1 && rule.days.join() === '1,2,3,4,5'

/** The rule in words, e.g. "every weekday at 09:00" or "every 30 minutes from 09:00 to 18:00". */
export function describeRepeat(rule: RepeatRule, time: string): string {
  const base = rule.every === 1 ? `every ${rule.unit}` : `every ${rule.every} ${rule.unit}s`
  if (isWeekdays(rule)) return `every weekday at ${time}`
  const on = rule.days.length === 0 ? '' : ` on ${rule.days.map((d) => DAY_NAMES[d]).join(', ')}`
  if (rule.unit === 'minute' || rule.unit === 'hour') {
    const until = rule.between === null ? '' : ` to ${rule.between.to}`
    return `${base}${on} from ${time}${until}`
  }
  return `${base}${on} at ${time}`
}
