// Human-readable durations for the factory's own numbers — a viewer reads "1
// h 20 min" faster than a millisecond count, and every dashboard that shows a
// duration (the Ledger's tiles, the hall's status wall) shares this one
// formatter rather than rolling its own.

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS

export function formatDuration(ms: number): string {
  if (ms < MINUTE_MS) return `${Math.round(ms / SECOND_MS)} s`
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)} min`
  const hours = Math.floor(ms / HOUR_MS)
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS)
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}
