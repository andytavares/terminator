import { describe, it, expect } from 'vitest'
import {
  transition,
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
  // Approving a spec and then editing it by hand is how you fix a typo, and
  // also how the plan downstream ends up built against something nobody
  // approved. This is what tells those apart.

  function approved(over: Partial<PilotState> = {}): PilotState {
    const state: PilotState = {
      version: 3,
      featureDir: '/repo/specs/021-a',
      card: {
        title: 'A card',
        type: 'feature',
        scope: '',
        checklist: [],
        attachments: [],
        knowledgeRefs: [],
        source: 'native',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      stage: 'in-progress',
      mode: 'speckit',
      ticket: null,
      run: null,
      queuePosition: null,
      worktreePath: null,
      branchName: null,
      prUrl: null,
      phases: Object.fromEntries(
        PHASE_ORDER.map((id) => [
          id,
          {
            id,
            status: 'locked',
            approvedHash: null,
            approvedAt: null,
            approvedBy: null,
            lastRunId: null,
            lastRunAt: null,
            artifactPaths: [],
            feedback: null,
            batchIndex: null,
          } as PhaseState,
        ])
      ) as Record<PhaseId, PhaseState>,
      settings: DEFAULT_SETTINGS,
      ...over,
    }
    state.phases.specify.status = 'approved'
    state.phases.specify.approvedHash = 'hash-at-approval'
    return state
  }

  it('marks a phase modified when its artifacts are not what was approved', () => {
    const after = applyHashVerification(approved(), { specify: 'a different hash' })
    expect(after.phases.specify.status).toBe('modified')
  })

  it('says modified rather than stale — they mean different things', () => {
    // Stale means something upstream moved; modified means the thing you
    // approved is not the thing on disk.
    const after = applyHashVerification(approved(), { specify: 'a different hash' })
    expect(after.phases.specify.status).not.toBe('stale')
  })

  it('leaves it alone when the artifacts are unchanged', () => {
    const state = approved()
    expect(applyHashVerification(state, { specify: 'hash-at-approval' })).toBe(state)
  })

  it('leaves a phase that was approved before hashes were kept', () => {
    // Reporting every one of those as modified would be noise nobody can act on.
    const state = approved()
    state.phases.specify.approvedHash = null
    expect(applyHashVerification(state, { specify: 'anything' }).phases.specify.status).toBe(
      'approved'
    )
  })

  it('leaves a phase nothing was computed for', () => {
    const state = approved()
    expect(applyHashVerification(state, {}).phases.specify.status).toBe('approved')
  })

  it('does not touch a phase that was never approved', () => {
    const state = approved()
    state.phases.plan.status = 'awaiting_review'
    state.phases.plan.approvedHash = 'hash-at-approval'
    expect(applyHashVerification(state, { plan: 'different' }).phases.plan.status).toBe(
      'awaiting_review'
    )
  })

  it('returns the same object when nothing changed, so a read is free', () => {
    const state = approved()
    expect(applyHashVerification(state, { specify: 'hash-at-approval' })).toBe(state)
  })
})
