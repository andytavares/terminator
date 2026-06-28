import { describe, it, expect } from 'vitest'
import {
  transition,
  isUpstreamApproved,
  computeStalePhases,
  applyHashVerification,
  shouldAutoApprove,
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
    feedback: null,
    batchIndex: null,
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
    version: 2,
    featureDir: 'specs/test',
    ticket: null,
    run: null,
    queuePosition: null,
    worktreePath: null,
    branchName: null,
    prUrl: null,
    phases,
    settings: DEFAULT_SETTINGS,
  }
}

describe('PHASE_ORDER', () => {
  it('contains exactly 10 phases', () => {
    expect(PHASE_ORDER).toHaveLength(10)
  })

  it('includes self-review as phase 9', () => {
    expect(PHASE_ORDER[8]).toBe('self-review')
  })

  it('includes open-pr as phase 10', () => {
    expect(PHASE_ORDER[9]).toBe('open-pr')
  })
})

describe('shouldAutoApprove()', () => {
  const fastGate = { required: true, autoApprove: true, perFileConfirm: false }
  const offGate = { required: true, autoApprove: false, perFileConfirm: false }

  it('returns false for self-review even when autonomy=fast and autoApprove=true', () => {
    expect(shouldAutoApprove('self-review', 'fast', fastGate)).toBe(false)
  })

  it('returns false for open-pr even when autonomy=fast and autoApprove=true', () => {
    expect(shouldAutoApprove('open-pr', 'fast', fastGate)).toBe(false)
  })

  it('returns true for specify when autonomy=fast and gate.autoApprove=true', () => {
    expect(shouldAutoApprove('specify', 'fast', fastGate)).toBe(true)
  })

  it('returns false for specify when autonomy=fast but gate.autoApprove=false', () => {
    expect(shouldAutoApprove('specify', 'fast', offGate)).toBe(false)
  })

  it('returns false for specify when autonomy=guided even if gate.autoApprove=true', () => {
    expect(shouldAutoApprove('specify', 'guided', fastGate)).toBe(false)
  })

  it('returns false for implement (perFileConfirm gate) even in fast autonomy', () => {
    const implementGate = { required: true, autoApprove: false, perFileConfirm: true }
    expect(shouldAutoApprove('implement', 'fast', implementGate)).toBe(false)
  })
})

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

  it('self-review transitions: locked → ready → running → awaiting_review → approved', () => {
    let ps = makePhaseState('locked', 'self-review')
    ps = transition(ps, 'upstream_approved')
    expect(ps.status).toBe('ready')
    ps = transition(ps, 'run_triggered')
    expect(ps.status).toBe('running')
    ps = transition(ps, 'artifact_detected')
    expect(ps.status).toBe('awaiting_review')
    ps = transition(ps, 'approved')
    expect(ps.status).toBe('approved')
  })

  it('open-pr transitions: locked → ready → running → awaiting_review → approved', () => {
    let ps = makePhaseState('locked', 'open-pr')
    ps = transition(ps, 'upstream_approved')
    expect(ps.status).toBe('ready')
    ps = transition(ps, 'run_triggered')
    expect(ps.status).toBe('running')
    ps = transition(ps, 'artifact_detected')
    expect(ps.status).toBe('awaiting_review')
    ps = transition(ps, 'approved')
    expect(ps.status).toBe('approved')
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

  it('self-review requires implement to be approved', () => {
    const state = makePilotState({ implement: { status: 'ready' } })
    expect(isUpstreamApproved(state, 'self-review')).toBe(false)
  })

  it('self-review unlocked when implement is approved', () => {
    const state = makePilotState({ implement: { status: 'approved', approvedHash: 'xyz' } })
    expect(isUpstreamApproved(state, 'self-review')).toBe(true)
  })

  it('open-pr requires self-review to be approved', () => {
    const state = makePilotState({ 'self-review': { status: 'ready' } })
    expect(isUpstreamApproved(state, 'open-pr')).toBe(false)
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

  it('returns empty array for open-pr (last phase)', () => {
    const state = makePilotState()
    expect(computeStalePhases(state, 'open-pr')).toEqual([])
  })

  it('revoke on implement marks self-review and open-pr stale if approved', () => {
    const state = makePilotState({
      implement: { status: 'approved', approvedHash: 'aaa' },
      'self-review': { status: 'approved', approvedHash: 'bbb' },
      'open-pr': { status: 'approved', approvedHash: 'ccc' },
    })
    const stale = computeStalePhases(state, 'implement')
    expect(stale).toContain('self-review')
    expect(stale).toContain('open-pr')
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
    expect(updated).toBe(state)
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
