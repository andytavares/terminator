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

export function isUpstreamApproved(state: PilotState, phase: PhaseId): boolean {
  const idx = PHASE_ORDER.indexOf(phase)
  if (idx <= 0) return true // constitution has no upstream

  const upstream = PHASE_ORDER[idx - 1]
  const upstreamState = state.phases[upstream]
  if (!upstreamState) return false

  // checklist does not require upstream approval (required: false)
  const gate = state.settings.phaseGates[phase]
  if (gate && !gate.required) return true

  return upstreamState.status === 'approved'
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

export function applyHashVerification(
  state: PilotState,
  diskHashes: Record<string, string | null>
): PilotState {
  const updated = structuredClone(state)
  let changed = false

  for (const phaseId of PHASE_ORDER) {
    const phaseState = updated.phases[phaseId]
    if (!phaseState || phaseState.status !== 'approved') continue
    if (!phaseState.approvedHash) continue

    for (const artifactPath of phaseState.artifactPaths) {
      const diskHash = diskHashes[artifactPath]
      if (diskHash === null) {
        // File missing — mark stale
        phaseState.status = 'stale'
        changed = true
        break
      }
      if (diskHash !== undefined && diskHash !== phaseState.approvedHash) {
        phaseState.status = 'stale'
        changed = true
        break
      }
    }
  }

  return changed ? updated : state
}
