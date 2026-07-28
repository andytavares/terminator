import { createJsonlLog } from '../storage/jsonl-log.js'
import type { StallFiring } from './evaluate-stall.js'

// Every firing is recorded, in every mode (FR-017) — shadow mode gates the
// consequence, never the record. The operator's judgements (FR-020) are what
// SC-002's precision target is actually measured against, so they live here
// too, appended rather than rewritten.

export type Judgement = 'correct' | 'incorrect'

export interface RecordedFiring extends StallFiring {
  readonly id: string
  readonly shadowMode: boolean
  readonly judgement: Judgement | null
  readonly judgedAt: number | null
}

/** A tombstone: this firing never happened as far as the record is concerned. */
interface RemovedRow {
  readonly kind: 'removed'
  readonly id: string
}

interface JudgementRow {
  readonly kind: 'judgement'
  readonly id: string
  readonly judgement: Judgement
  readonly judgedAt: number
}

type Row = (RecordedFiring & { kind?: 'firing' }) | JudgementRow | RemovedRow

/**
 * The log is a file on disk: it can be truncated by a crash, hand-edited, or
 * written by an older build that had fewer fields. A row that is not a whole
 * firing is dropped rather than surfaced — the surfaces dereference `inputs`
 * directly, so one bad line would otherwise blank every supervision screen
 * behind an error boundary, which is precisely the silent failure this console
 * exists to prevent.
 */
function isWholeFiring(row: unknown): row is RecordedFiring {
  if (typeof row !== 'object' || row === null) return false
  const candidate = row as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.sessionId !== 'string') return false
  if (typeof candidate.signal !== 'string' || typeof candidate.firedAt !== 'number') return false

  const inputs = candidate.inputs
  if (typeof inputs !== 'object' || inputs === null) return false
  const values = inputs as Record<string, unknown>
  return (
    typeof values.toolSilenceMs === 'number' &&
    typeof values.diffSilenceMs === 'number' &&
    typeof values.distinctFiles === 'number' &&
    typeof values.netChange === 'number' &&
    typeof values.reverts === 'number' &&
    typeof values.shellInFlight === 'boolean'
  )
}

export interface PrecisionReport {
  readonly total: number
  readonly judged: number
  readonly incorrect: number
  /** Null when nothing has been judged — unknown is not the same as perfect. */
  readonly incorrectRate: number | null
}

export interface FiringLog {
  record(firing: StallFiring, shadowMode: boolean): void
  judge(id: string, judgement: Judgement, at: number): void
  /** Firings still awaiting a judgement. Judging one is what takes it off. */
  list(): RecordedFiring[]
  /** Every firing, judged or not — what the precision figure is measured over. */
  all(): RecordedFiring[]
  /** Removes a firing entirely — from the list and from the precision figure. */
  remove(id: string): void
  precision(fromMs: number, toMs: number): PrecisionReport
}

export function createFiringLog(path: string): FiringLog {
  const log = createJsonlLog<Row>(path)
  let counter = 0

  function materialise(): RecordedFiring[] {
    const firings = new Map<string, RecordedFiring>()
    // Append-only: a later judgement row supersedes an earlier one for the same
    // firing, which is how a judgement can be revised without a rewrite.
    for (const row of log.readAll()) {
      if ((row as RemovedRow).kind === 'removed') {
        firings.delete((row as RemovedRow).id)
        continue
      }
      if ((row as JudgementRow).kind === 'judgement') {
        const judgementRow = row as JudgementRow
        const existing = firings.get(judgementRow.id)
        if (existing === undefined) continue
        firings.set(judgementRow.id, {
          ...existing,
          judgement: judgementRow.judgement,
          judgedAt: judgementRow.judgedAt,
        })
      } else if (isWholeFiring(row)) {
        const firing = row
        firings.set(firing.id, firing)
      }
    }
    return [...firings.values()]
  }

  return {
    record(firing: StallFiring, shadowMode: boolean): void {
      log.append({
        ...firing,
        id: `${firing.sessionId}-${firing.firedAt}-${++counter}`,
        shadowMode,
        judgement: null,
        judgedAt: null,
      })
    },

    judge(id: string, judgement: Judgement, at: number): void {
      if (!materialise().some((f) => f.id === id)) return
      log.append({ kind: 'judgement', id, judgement, judgedAt: at })
    },

    remove(id: string): void {
      log.append({ kind: 'removed', id })
    },

    all(): RecordedFiring[] {
      return materialise()
    },

    list(): RecordedFiring[] {
      // Only what still needs judging. A firing you have already called right
      // or wrong is answered, and leaving it on the list makes the list read
      // as work outstanding when it is not — the precision figure above it is
      // where judged ones continue to count.
      return materialise().filter((firing) => firing.judgement === null)
    },

    remove(id: string): void {
      log.append({ kind: 'removed', id })
    },

    precision(fromMs: number, toMs: number): PrecisionReport {
      const inWindow = materialise().filter((f) => f.firedAt >= fromMs && f.firedAt <= toMs)
      const judged = inWindow.filter((f) => f.judgement !== null)
      const incorrect = judged.filter((f) => f.judgement === 'incorrect').length
      return {
        total: inWindow.length,
        judged: judged.length,
        incorrect,
        incorrectRate: judged.length === 0 ? null : incorrect / judged.length,
      }
    },
  }
}
