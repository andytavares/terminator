import type { FeedEntry } from './feed-log.js'

// Notification discipline (FR-023, FR-028). Automation complacency is the
// documented failure mode of supervisory control: a console that only speaks up
// when something is wrong teaches the operator that silence means fine, and
// silence is exactly what a crashed console also looks like.
//
// So: modal for a blocking permission request only, non-blocking indication for
// anything else that needs a person, and routine progress batched into a
// digest rather than interrupting at all.

export type NotificationChannel = 'modal' | 'indicator' | 'digest'

export interface NotifiableEvent {
  readonly kind: 'permission_requested' | 'stalled' | 'failed' | 'ready' | 'progress'
  readonly sessionId: string
}

export function channelFor(event: NotifiableEvent): NotificationChannel {
  switch (event.kind) {
    case 'permission_requested':
      // The only thing that may interrupt: an agent is stopped dead until it
      // is answered.
      return 'modal'
    case 'stalled':
    case 'failed':
    case 'ready':
      return 'indicator'
    case 'progress':
      return 'digest'
  }
}

export interface Digest {
  readonly from: number
  readonly to: number
  readonly entryCount: number
  readonly sessionCount: number
  readonly bySession: Array<{ sessionId: string; entries: FeedEntry[] }>
}

/** Batches an interval of feed entries into one thing to read. */
export function buildDigest(entries: readonly FeedEntry[], from: number, to: number): Digest {
  const inWindow = entries
    .filter((entry) => entry.at >= from && entry.at <= to)
    .sort((a, b) => a.at - b.at)

  const bySession = new Map<string, FeedEntry[]>()
  for (const entry of inWindow) {
    bySession.set(entry.sessionId, [...(bySession.get(entry.sessionId) ?? []), entry])
  }

  return {
    from,
    to,
    entryCount: inWindow.length,
    sessionCount: bySession.size,
    bySession: [...bySession]
      .map(([sessionId, sessionEntries]) => ({ sessionId, entries: sessionEntries }))
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
  }
}
