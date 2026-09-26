// Human-readable durations for the factory's own numbers — a viewer reads "1
// h 20 min" faster than a millisecond count, and every dashboard that shows a
// duration (the Ledger's tiles, the hall's status wall) shares this one
// formatter rather than rolling its own.

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS

/** "1st", "2nd", "3rd", "4th" — the refinery queue's own position, said in words. */
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

export function formatDuration(ms: number): string {
  if (ms < MINUTE_MS) return `${Math.round(ms / SECOND_MS)} s`
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)} min`
  const hours = Math.floor(ms / HOUR_MS)
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS)
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}
