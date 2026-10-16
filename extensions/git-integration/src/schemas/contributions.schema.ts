import { z } from 'zod'

// The reply of the `github:contributions` channel, as the view parses it. The day shape
// matches CalendarDay in src/review/contribution-calendar.ts; it is re-declared here
// because that module runs backend-only (Temporal, ADR 108) and the view never imports it.

const ContributionCountsSchema = z.object({
  opened: z.number(),
  merged: z.number(),
  reviewed: z.number(),
  total: z.number(),
})

export type ContributionCounts = z.infer<typeof ContributionCountsSchema>

const CalendarDaySchema = ContributionCountsSchema.extend({
  date: z.string(),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  future: z.boolean(),
})

export type ContributionsDay = z.infer<typeof CalendarDaySchema>

const ContributionsCalendarSchema = z.object({
  weeks: z.array(z.array(CalendarDaySchema)),
  total: z.number(),
  currentStreak: z.number(),
  longestStreak: z.number(),
  mostActiveMonth: z.object({ month: z.string(), total: z.number() }).nullable(),
  mostActiveWeekday: z.object({ weekday: z.number(), total: z.number() }).nullable(),
})

export type ContributionsCalendar = z.infer<typeof ContributionsCalendarSchema>

export const ContributionsReplySchema = z.object({
  calendar: ContributionsCalendarSchema,
  period: ContributionCountsSchema,
  previous: ContributionCountsSchema,
  repos: z.array(z.string()),
  fetchedAt: z.string(),
})

export type ContributionsReply = z.infer<typeof ContributionsReplySchema>
