import type { SessionRecord } from '../types/index.js'

/** How long a closed session's context stays findable. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The records still worth keeping at `now`.
 *
 * An open record is always kept: its session is running, so its age says
 * nothing. A closed record whose close time cannot be read is dropped, because
 * there is no moment to measure its retention from.
 */
export function pruneRecords(records: readonly SessionRecord[], now: number): SessionRecord[] {
  return records.filter((record) => {
    if (record.closedAt === undefined) return true
    const closedAt = Date.parse(record.closedAt)
    return !Number.isNaN(closedAt) && now - closedAt <= RETENTION_MS
  })
}
