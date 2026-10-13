/** Entries in the refinery's queue, for specs that wire one into a channel. */
import type { QueueEntry } from '../../src/line/refinery.js'

/** An unmerged order on `main` of `repo`, agreed on 1 September; `over` changes any part. */
export function queued(orderId: string, over: Partial<QueueEntry> = {}): QueueEntry {
  return {
    orderId,
    title: orderId,
    repo: 'repo',
    base: 'main',
    agreedAt: '2026-09-01T00:00:00.000Z',
    files: ['src/a.ts'],
    merged: false,
    ...over,
  }
}
