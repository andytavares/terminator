import { describe, it, expect } from 'vitest'
import { deriveStage } from '../../src/state/derive-stage.js'
import { PHASE_ORDER } from '../../src/types/speckit.types.js'
import type { PhaseId, PhaseState, PhaseStatus, RunMeta } from '../../src/types/speckit.types.js'

function phase(id: PhaseId, status: PhaseStatus): PhaseState {
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

/**
 * Realistic progression: every phase before `current` is approved, `current` has
 * the given status, and every phase after is locked.
 */
function phasesAt(current: PhaseId, status: PhaseStatus): Record<PhaseId, PhaseState> {
  const idx = PHASE_ORDER.indexOf(current)
  return Object.fromEntries(
    PHASE_ORDER.map((id, i) => [
      id,
      phase(id, i < idx ? 'approved' : i === idx ? status : 'locked'),
    ])
  ) as Record<PhaseId, PhaseState>
}

/** Every phase set to the same status. */
function phasesAll(status: PhaseStatus): Record<PhaseId, PhaseState> {
  return Object.fromEntries(PHASE_ORDER.map((id) => [id, phase(id, status)])) as Record<
    PhaseId,
    PhaseState
  >
}

const runningRun: RunMeta = {
  status: 'running',
  startedAt: '2026-06-30T00:00:00.000Z',
  completedAt: null,
  autonomyLevel: 'standard',
}

describe('deriveStage', () => {
  it('returns backlog when there is no run', () => {
    expect(deriveStage(phasesAt('constitution', 'ready'), null)).toBe('backlog')
  })

  it('maps all build phases (constitution…implement) to in-progress', () => {
    expect(deriveStage(phasesAt('constitution', 'running'), runningRun)).toBe('in-progress')
    expect(deriveStage(phasesAt('specify', 'awaiting_review'), runningRun)).toBe('in-progress')
    expect(deriveStage(phasesAt('clarify', 'running'), runningRun)).toBe('in-progress')
    expect(deriveStage(phasesAt('plan', 'running'), runningRun)).toBe('in-progress')
    expect(deriveStage(phasesAt('checklist', 'awaiting_review'), runningRun)).toBe('in-progress')
    expect(deriveStage(phasesAt('tasks', 'awaiting_review'), runningRun)).toBe('in-progress')
    expect(deriveStage(phasesAt('analyze', 'ready'), runningRun)).toBe('in-progress')
    expect(deriveStage(phasesAt('implement', 'running'), runningRun)).toBe('in-progress')
  })

  it('maps self-review/open-pr to in-review', () => {
    expect(deriveStage(phasesAt('self-review', 'awaiting_review'), runningRun)).toBe('in-review')
    expect(deriveStage(phasesAt('open-pr', 'ready'), runningRun)).toBe('in-review')
  })

  it('returns done when open-pr is approved', () => {
    expect(deriveStage(phasesAll('approved'), runningRun)).toBe('done')
  })

  it('returns done when the run is completed', () => {
    const completed: RunMeta = {
      ...runningRun,
      status: 'completed',
      completedAt: '2026-06-30T01:00:00.000Z',
    }
    expect(deriveStage(phasesAt('implement', 'running'), completed)).toBe('done')
  })

  it('keeps a failed run in its last active column (not backlog)', () => {
    const failed: RunMeta = { ...runningRun, status: 'failed' }
    expect(deriveStage(phasesAt('implement', 'failed'), failed)).toBe('in-progress')
  })

  it('is total: always returns a valid BoardStage', () => {
    expect(['backlog', 'in-progress', 'in-review', 'done']).toContain(
      deriveStage(phasesAll('skipped'), runningRun)
    )
  })
})
