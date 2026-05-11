import { describe, it, expect } from 'vitest'
import {
  transition,
  isUpstreamApproved,
  computeStalePhases,
  applyHashVerification,
  InvalidTransitionError,
} from '../../src/state/phase-state-machine.js'
import type { PhaseState, PilotState } from '../../src/types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from '../../src/types/speckit.types.js'

function makePhaseState(
  status: PhaseState['status'],
  id = 'constitution' as PhaseState['id']
): PhaseState {
  return {
    id,
    status,
    approvedHash: null,
    approvedAt: null,
    approvedBy: null,
    lastRunId: null,
    lastRunAt: null,
    artifactPaths: [],
  }
}

function makePilotState(overrides: Partial<Record<string, Partial<PhaseState>>> = {}): PilotState {
  const phases = Object.fromEntries(
    PHASE_ORDER.map((id, idx) => [
      id,
      {
        ...makePhaseState(idx === 0 ? 'ready' : 'locked', id),
        ...(overrides[id] ?? {}),
      },
    ])
  ) as PilotState['phases']

  return {
    version: 1,
    featureDir: 'specs/test',
    phases,
    settings: DEFAULT_SETTINGS,
  }
}

describe('transition()', () => {
  it('locked → ready on upstream_approved', () => {
    const ps = makePhaseState('locked')
    const result = transition(ps, 'upstream_approved')
    expect(result.status).toBe('ready')
  })

  it('ready → running on run_triggered', () => {
    const ps = makePhaseState('ready')
    expect(transition(ps, 'run_triggered').status).toBe('running')
  })

  it('running → awaiting_review on artifact_detected', () => {
    const ps = makePhaseState('running')
    expect(transition(ps, 'artifact_detected').status).toBe('awaiting_review')
  })

  it('running → failed on timeout', () => {
    const ps = makePhaseState('running')
    expect(transition(ps, 'timeout').status).toBe('failed')
  })

  it('failed → ready on retry', () => {
    const ps = makePhaseState('failed')
    expect(transition(ps, 'retry').status).toBe('ready')
  })

  it('awaiting_review → approved on approved', () => {
    const ps = makePhaseState('awaiting_review')
    expect(transition(ps, 'approved').status).toBe('approved')
  })

  it('awaiting_review → ready on rejected', () => {
    const ps = makePhaseState('awaiting_review')
    expect(transition(ps, 'rejected').status).toBe('ready')
  })

  it('approved → stale on upstream_hash_changed', () => {
    const ps = makePhaseState('approved')
    expect(transition(ps, 'upstream_hash_changed').status).toBe('stale')
  })

  it('approved → modified on artifact_modified', () => {
    const ps = makePhaseState('approved')
    expect(transition(ps, 'artifact_modified').status).toBe('modified')
  })

  it('modified → awaiting_review on save_edits', () => {
    const ps = makePhaseState('modified')
    expect(transition(ps, 'save_edits').status).toBe('awaiting_review')
  })

  it('stale → running on re_run', () => {
    const ps = makePhaseState('stale')
    expect(transition(ps, 're_run').status).toBe('running')
  })

  it('approved → ready on revoke', () => {
    const ps = makePhaseState('approved')
    expect(transition(ps, 'revoke').status).toBe('ready')
  })

  it('throws InvalidTransitionError for locked → run_triggered', () => {
    const ps = makePhaseState('locked')
    expect(() => transition(ps, 'run_triggered')).toThrow(InvalidTransitionError)
  })

  it('throws InvalidTransitionError for approved → run_triggered', () => {
    const ps = makePhaseState('approved')
    expect(() => transition(ps, 'run_triggered')).toThrow(InvalidTransitionError)
  })

  it('does not mutate input phase state', () => {
    const ps = makePhaseState('ready')
    const result = transition(ps, 'run_triggered')
    expect(ps.status).toBe('ready')
    expect(result.status).toBe('running')
    expect(result).not.toBe(ps)
  })
})

describe('isUpstreamApproved()', () => {
  it('returns true for constitution (no upstream)', () => {
    const state = makePilotState()
    expect(isUpstreamApproved(state, 'constitution')).toBe(true)
  })

  it('returns false when upstream is ready (not approved)', () => {
    const state = makePilotState({ constitution: { status: 'ready' } })
    expect(isUpstreamApproved(state, 'specify')).toBe(false)
  })

  it('returns true when upstream is approved', () => {
    const state = makePilotState({ constitution: { status: 'approved', approvedHash: 'abc' } })
    expect(isUpstreamApproved(state, 'specify')).toBe(true)
  })

  it('checklist does not require upstream approval (gate.required=false)', () => {
    const state = makePilotState({ tasks: { status: 'ready' } })
    expect(isUpstreamApproved(state, 'checklist')).toBe(true)
  })
})

describe('computeStalePhases()', () => {
  it('returns downstream approved phases', () => {
    const state = makePilotState({
      constitution: { status: 'approved', approvedHash: 'aaa' },
      specify: { status: 'approved', approvedHash: 'bbb' },
      clarify: { status: 'approved', approvedHash: 'ccc' },
      plan: { status: 'ready' },
    })
    const stale = computeStalePhases(state, 'constitution')
    expect(stale).toContain('specify')
    expect(stale).toContain('clarify')
    expect(stale).not.toContain('plan')
  })

  it('returns empty array when no downstream phases are approved', () => {
    const state = makePilotState()
    expect(computeStalePhases(state, 'constitution')).toEqual([])
  })

  it('returns empty array for implement (last phase)', () => {
    const state = makePilotState()
    expect(computeStalePhases(state, 'implement')).toEqual([])
  })
})

describe('applyHashVerification()', () => {
  it('marks phase stale when disk hash differs from approved hash', () => {
    const state = makePilotState({
      constitution: {
        status: 'approved',
        approvedHash: 'aaaa1234',
        artifactPaths: ['.specify/memory/constitution.md'],
      },
    })
    const updated = applyHashVerification(state, {
      '.specify/memory/constitution.md': 'bbbb5678',
    })
    expect(updated.phases['constitution'].status).toBe('stale')
  })

  it('does not mutate when hashes match', () => {
    const state = makePilotState({
      constitution: {
        status: 'approved',
        approvedHash: 'aaaa1234',
        artifactPaths: ['.specify/memory/constitution.md'],
      },
    })
    const updated = applyHashVerification(state, {
      '.specify/memory/constitution.md': 'aaaa1234',
    })
    expect(updated).toBe(state) // same reference = no change
  })

  it('marks phase stale when file is missing (null hash)', () => {
    const state = makePilotState({
      specify: {
        status: 'approved',
        approvedHash: 'aaaa1234',
        artifactPaths: ['specs/test/spec.md'],
      },
    })
    const updated = applyHashVerification(state, {
      'specs/test/spec.md': null,
    })
    expect(updated.phases['specify'].status).toBe('stale')
  })

  it('ignores non-approved phases', () => {
    const state = makePilotState({
      constitution: { status: 'ready', artifactPaths: ['.specify/memory/constitution.md'] },
    })
    const updated = applyHashVerification(state, {
      '.specify/memory/constitution.md': 'differenthash',
    })
    expect(updated.phases['constitution'].status).toBe('ready')
  })
})
