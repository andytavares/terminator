import { createJsonlLog } from '../jsonl-log.js'

// Backpressure. When unreviewed finished work reaches the limit, starting
// another agent is refused with a stated reason (FR-053), overridable in one
// action, and every override is recorded (FR-054).
//
// Counted globally rather than per repository: the bottleneck being modelled is
// one operator's review capacity, which does not partition by repo.
//
// This is a check performed at start time. It never touches running agents — a
// console that opens with the limit already exceeded must not kill work already
// in flight (spec Edge Cases).

export interface BackpressureDecision {
  readonly allowed: boolean
  readonly unreviewed: number
  readonly limit: number
  readonly reason: string | null
}

export interface BackpressureOverride {
  readonly sessionId: string
  readonly at: number
  readonly queueDepth: number
}

export interface BackpressureGateOptions {
  limit: number
  countUnreviewed: () => number
  overrideLogPath: string
}

export interface BackpressureGate {
  check(): BackpressureDecision
  override(sessionId: string, at: number): void
  overrides(): BackpressureOverride[]
}

export function createBackpressureGate(options: BackpressureGateOptions): BackpressureGate {
  const { limit, countUnreviewed, overrideLogPath } = options
  const log = createJsonlLog<BackpressureOverride>(overrideLogPath)

  return {
    check(): BackpressureDecision {
      const unreviewed = countUnreviewed()
      const allowed = unreviewed < limit
      return {
        allowed,
        unreviewed,
        limit,
        reason: allowed
          ? null
          : `${unreviewed} finished ${unreviewed === 1 ? 'session is' : 'sessions are'} waiting for review, and the limit is ${limit}. Review something, or override.`,
      }
    },

    override(sessionId: string, at: number): void {
      // The queue depth is captured at the moment of the override, not read
      // back later — the point of the record is what you chose to ignore.
      log.append({ sessionId, at, queueDepth: countUnreviewed() })
    },

    overrides(): BackpressureOverride[] {
      return log.readAll()
    },
  }
}
