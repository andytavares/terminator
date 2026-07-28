import { createJsonlLog } from '../storage/jsonl-log.js'
import type { IntakeStub } from './intake.js'

// Where a queued ticket actually lives.
//
// Intake returned a stub and nothing kept it, so the board never showed one and
// "Queued as FLU-221. It waits until you start it." was not true of anything.
//
// Append-only, like the other records: a crash costs the last line rather than
// the queue, and removing something is a tombstone rather than a rewrite.

interface QueuedRow extends IntakeStub {
  readonly kind?: 'queued'
}

interface RemovedRow {
  readonly kind: 'removed'
  readonly id: string
  readonly at: number
}

type Row = QueuedRow | RemovedRow

export interface IntakeQueue {
  add(stub: IntakeStub): void
  remove(id: string, at: number): void
  list(): IntakeStub[]
}

function isRemoval(row: Row): row is RemovedRow {
  return (row as RemovedRow).kind === 'removed'
}

/** A row that is not a whole stub is dropped rather than surfaced. */
function isWholeStub(row: unknown): row is QueuedRow {
  if (typeof row !== 'object' || row === null) return false
  const candidate = row as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.source === 'string' &&
    typeof candidate.createdAt === 'number'
  )
}

export function createIntakeQueue(path: string): IntakeQueue {
  const log = createJsonlLog<Row>(path)

  return {
    add(stub: IntakeStub): void {
      log.append({ ...stub, kind: 'queued' })
    },

    remove(id: string, at: number): void {
      log.append({ kind: 'removed', id, at })
    },

    list(): IntakeStub[] {
      const queued = new Map<string, IntakeStub>()
      for (const row of log.readAll()) {
        if (isRemoval(row)) {
          queued.delete(row.id)
          continue
        }
        // Pulling the same issue twice is normal — it updates rather than
        // duplicating, so a second pull is safe to run whenever.
        if (isWholeStub(row)) queued.set(row.id, row)
      }
      return [...queued.values()].sort((a, b) => b.createdAt - a.createdAt)
    },
  }
}
