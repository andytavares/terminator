const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Each unit applies until the next one's size is reached; the last has no limit.
const UNITS: readonly { unit: Intl.RelativeTimeFormatUnit; size: number; until: number }[] = [
  { unit: 'second', size: SECOND, until: MINUTE },
  { unit: 'minute', size: MINUTE, until: HOUR },
  { unit: 'hour', size: HOUR, until: DAY },
  { unit: 'day', size: DAY, until: 7 * DAY },
  { unit: 'week', size: 7 * DAY, until: 30 * DAY },
  { unit: 'month', size: 30 * DAY, until: 365 * DAY },
  { unit: 'year', size: 365 * DAY, until: Infinity },
]

export type TimeInput = Date | number | string

export function toMilliseconds(value: TimeInput): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

/**
 * "5 minutes ago", "in 2 hours", "yesterday", in the reader's language.
 *
 * Fourteen hand-written variants of this sentence had drifted apart: five
 * minutes was six different strings. One unit picker and `Intl` replace them.
 */
export function formatRelativeTime(
  from: TimeInput,
  now: TimeInput = Date.now(),
  locale?: string
): string {
  const difference = toMilliseconds(from) - toMilliseconds(now)
  const magnitude = Math.abs(difference)
  const { unit, size } = UNITS.find((candidate) => magnitude < candidate.until) ?? UNITS[6]
  const count = Math.trunc(difference / size)
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(count, unit)
}
