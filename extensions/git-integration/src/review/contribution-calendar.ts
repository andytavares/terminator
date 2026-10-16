// The contribution calendar's sums (ADR 108). Backend only: the view has no Temporal.

/** What one contribution to a pull request is. */
export type ContributionKind = 'opened' | 'merged' | 'reviewed'

/** One contribution: its kind, the ISO instant it happened at, and the `owner/name` it was on. */
export interface Contribution {
  kind: ContributionKind
  at: string
  repo: string
}

/** How many contributions of each kind a day or range holds, and their sum. */
export interface ContributionCounts {
  opened: number
  merged: number
  reviewed: number
  total: number
}

/** One day of the calendar. `level` is 0 for an empty day, else 1..4 by quartile. */
export interface CalendarDay extends ContributionCounts {
  date: string
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
}

/** A year of contributions: 53 Monday-first weeks ending this week, plus the headline sums. */
export interface ContributionCalendar {
  weeks: CalendarDay[][]
  total: number
  currentStreak: number
  longestStreak: number
  mostActiveMonth: { month: string; total: number } | null
  mostActiveWeekday: { weekday: number; total: number } | null
}

interface CountedDay extends ContributionCounts {
  date: string
  weekday: number
}

const WEEKS = 53

function contributionDate(at: string, timeZone: string): string {
  return Temporal.Instant.from(at).toZonedDateTimeISO(timeZone).toPlainDate().toString()
}

/** The first day of the calendar: the Monday of `today`'s week, 52 weeks back. */
export function calendarStart(today: string): string {
  const date = Temporal.PlainDate.from(today)
  return date
    .subtract({ days: date.dayOfWeek - 1 })
    .subtract({ weeks: WEEKS - 1 })
    .toString()
}

/** The contributions falling on each local date of `range`, inclusive, in `timeZone`. */
function countDays(
  contributions: Contribution[],
  range: { from: string; to: string },
  timeZone: string
): CountedDay[] {
  const byDate = new Map<string, ContributionCounts>()
  for (const c of contributions) {
    const date = contributionDate(c.at, timeZone)
    if (date < range.from || date > range.to) continue
    const day = byDate.get(date) ?? { opened: 0, merged: 0, reviewed: 0, total: 0 }
    day[c.kind] += 1
    day.total += 1
    byDate.set(date, day)
  }
  const first = Temporal.PlainDate.from(range.from)
  return Array.from({ length: first.until(Temporal.PlainDate.from(range.to)).days + 1 }, (_, i) => {
    const date = first.add({ days: i })
    const counts = byDate.get(date.toString()) ?? { opened: 0, merged: 0, reviewed: 0, total: 0 }
    return { date: date.toString(), weekday: date.dayOfWeek, ...counts }
  })
}

function levelOf(total: number, quartiles: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (total === 0) return 0
  if (total <= quartiles[0]) return 1
  if (total <= quartiles[1]) return 2
  if (total <= quartiles[2]) return 3
  return 4
}

/** The .25, .5 and .75 quartiles of the non-zero totals, at floor(f*(n-1)) of the sorted list. */
function quartiles(days: CountedDay[]): [number, number, number] {
  const totals = days
    .map((d) => d.total)
    .filter((t) => t > 0)
    .sort((a, b) => a - b)
  return [0.25, 0.5, 0.75].map((f) => totals[Math.floor(f * (totals.length - 1))]) as [
    number,
    number,
    number,
  ]
}

/** Current and longest streak up to today: a weekday with nothing breaks; a weekend does not. */
function streaks(days: CountedDay[], today: string): { current: number; longest: number } {
  let current = 0
  let longest = 0
  for (const day of days) {
    if (day.date > today) break
    if (day.total > 0) current += 1
    else if (day.date === today || day.weekday >= 6) continue
    else current = 0
    longest = Math.max(longest, current)
  }
  return { current, longest }
}

/** The group with the largest total; a tie goes to the group `prefer` ranks first. */
function mostActive<K>(
  groups: Map<K, number>,
  prefer: (a: K, b: K) => K
): { key: K; total: number } | null {
  let best: { key: K; total: number } | null = null
  for (const [key, total] of groups) {
    if (!best || total > best.total || (total === best.total && prefer(key, best.key) === key)) {
      best = { key, total }
    }
  }
  return best && best.total > 0 ? best : null
}

/** Each day's total added up under the key `keyOf` gives it. */
function totalsBy<K>(days: CountedDay[], keyOf: (day: CountedDay) => K): Map<K, number> {
  const totals = new Map<K, number>()
  for (const day of days) totals.set(keyOf(day), (totals.get(keyOf(day)) ?? 0) + day.total)
  return totals
}

/** The empty days after `today`, through the Sunday of its week. */
function futureDays(today: string): CountedDay[] {
  const date = Temporal.PlainDate.from(today)
  return Array.from({ length: 7 - date.dayOfWeek }, (_, i) => {
    const day = date.add({ days: i + 1 })
    return {
      date: day.toString(),
      weekday: day.dayOfWeek,
      opened: 0,
      merged: 0,
      reviewed: 0,
      total: 0,
    }
  })
}

/** The calendar for a year of contributions, ending the week of `today`, all in `timeZone`. */
export function buildContributionCalendar(
  contributions: Contribution[],
  today: string,
  timeZone: string
): ContributionCalendar {
  const counted = countDays(contributions, { from: calendarStart(today), to: today }, timeZone)
  const days = [...counted, ...futureDays(today)]
  const levels = quartiles(counted)
  const month = mostActive(
    totalsBy(counted, (day) => day.date.slice(0, 7)),
    (a, b) => (a > b ? a : b)
  )
  const weekday = mostActive(
    totalsBy(counted, (day) => day.weekday),
    (a, b) => (a < b ? a : b)
  )
  const streak = streaks(counted, today)
  return {
    weeks: Array.from({ length: WEEKS }, (_, w) =>
      days
        .slice(w * 7, w * 7 + 7)
        .map((d) => ({ ...d, level: levelOf(d.total, levels), future: d.date > today }))
    ),
    total: counted.reduce((sum, d) => sum + d.total, 0),
    currentStreak: streak.current,
    longestStreak: streak.longest,
    mostActiveMonth: month && { month: month.key, total: month.total },
    mostActiveWeekday: weekday && { weekday: weekday.key, total: weekday.total },
  }
}

/** The counts on the inclusive local dates `from`..`to`, in `timeZone`. */
export function countBetween(
  contributions: Contribution[],
  range: { from: string; to: string },
  timeZone: string
): ContributionCounts {
  const counts: ContributionCounts = { opened: 0, merged: 0, reviewed: 0, total: 0 }
  for (const c of contributions) {
    const date = contributionDate(c.at, timeZone)
    if (date >= range.from && date <= range.to) {
      counts[c.kind] += 1
      counts.total += 1
    }
  }
  return counts
}

/** The range of the same length as `range`, ending the day before `range.from`. */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const from = Temporal.PlainDate.from(range.from)
  const to = Temporal.PlainDate.from(range.to)
  const days = from.until(to).days + 1
  const newTo = from.subtract({ days: 1 })
  return { from: newTo.subtract({ days: days - 1 }).toString(), to: newTo.toString() }
}
