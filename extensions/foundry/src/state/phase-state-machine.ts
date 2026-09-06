import type { PhaseId, PhaseStatus, PhaseState, PilotState } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'

type PhaseEvent =
  | 'upstream_approved'
  | 'run_triggered'
  | 'artifact_detected'
  | 'timeout'
  | 'retry'
  | 'approved'
  | 'rejected'
  | 'upstream_hash_changed'
  | 'artifact_modified'
  | 'save_edits'
  | 're_run'
  | 'revoke'

// Valid transitions: [from, event] -> to
const TRANSITIONS: Partial<Record<PhaseStatus, Partial<Record<PhaseEvent, PhaseStatus>>>> = {
  locked: {
    upstream_approved: 'ready',
  },
  ready: {
    run_triggered: 'running',
  },
  running: {
    artifact_detected: 'awaiting_review',
    timeout: 'failed',
  },
  failed: {
    retry: 'ready',
  },
  awaiting_review: {
    approved: 'approved',
    rejected: 'ready',
  },
  approved: {
    upstream_hash_changed: 'stale',
    artifact_modified: 'modified',
    revoke: 'ready',
  },
  modified: {
    save_edits: 'awaiting_review',
    re_run: 'awaiting_review',
  },
  stale: {
    re_run: 'running',
  },
}

export class InvalidTransitionError extends Error {
  constructor(from: PhaseStatus, event: PhaseEvent) {
    super(`Invalid transition: ${from} + ${event}`)
    this.name = 'InvalidTransitionError'
  }
}

export function transition(phaseState: PhaseState, event: PhaseEvent): PhaseState {
  const allowed = TRANSITIONS[phaseState.status]
  const next = allowed?.[event]
  if (!next) {
    throw new InvalidTransitionError(phaseState.status, event)
  }
  return { ...phaseState, status: next }
}

export function computeStalePhases(state: PilotState, changedPhase: PhaseId): PhaseId[] {
  const idx = PHASE_ORDER.indexOf(changedPhase)
  if (idx < 0) return []

  const stale: PhaseId[] = []
  for (let i = idx + 1; i < PHASE_ORDER.length; i++) {
    const id = PHASE_ORDER[i]
    const ps = state.phases[id]
    if (ps && ps.status === 'approved') {
      stale.push(id)
    }
  }
  return stale
}

/**
 * Marks an approved phase whose artifacts have changed since.
 *
 * `modified`, not `stale`: the state machine above distinguishes them, and so
 * should the board. Stale means something upstream moved; modified means the
 * thing you approved is not the thing on disk any more.
 *
 * Keyed by phase rather than by path, because the approved hash covers a
 * phase's artifacts as a set. A phase with no recorded hash is left alone: it
 * was approved before hashes were kept, and reporting every one of those as
 * modified would be noise nobody could act on.
 */
export function applyHashVerification(
  state: PilotState,
  hashesByPhase: Partial<Record<PhaseId, string | null>>
): PilotState {
  const updated = structuredClone(state)
  let changed = false

  for (const phaseId of PHASE_ORDER) {
    const phaseState = updated.phases[phaseId]
    if (!phaseState || phaseState.status !== 'approved') continue
    if (!phaseState.approvedHash) continue

    const current = hashesByPhase[phaseId]
    // `undefined` means nothing was computed for it — not that it is gone.
    if (current === undefined) continue
    if (current === phaseState.approvedHash) continue

    phaseState.status = 'modified'
    changed = true
  }

  return changed ? updated : state
}
