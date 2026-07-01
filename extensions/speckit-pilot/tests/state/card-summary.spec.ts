import { describe, it, expect } from 'vitest'
import { buildCardSummary, computeRunStatus } from '../../src/state/card-summary.js'
import { createInitialState } from '../../src/state/state-persistence.js'
import { createDefaultBrief, PHASE_ORDER } from '../../src/types/speckit.types.js'
import type { RunMeta } from '../../src/types/speckit.types.js'

const featureDir = '/specs/016-demo'

const running: RunMeta = {
  status: 'running',
  startedAt: '2026-06-30T00:00:00.000Z',
  completedAt: null,
  autonomyLevel: 'standard',
}

describe('computeRunStatus', () => {
  it('is none for a backlog card with no run', () => {
    expect(computeRunStatus(createInitialState(featureDir))).toBe('none')
  })

  it('is waiting when queued as pending', () => {
    const state = createInitialState(featureDir, { run: running })
    state.queuePosition = 'pending'
    expect(computeRunStatus(state)).toBe('waiting')
  })

  it('is running for an active run with no phase awaiting review', () => {
    const state = createInitialState(featureDir, { run: running })
    state.queuePosition = 'active'
    expect(computeRunStatus(state)).toBe('running')
  })

  it('is awaiting_review when a phase awaits review', () => {
    const state = createInitialState(featureDir, { run: running })
    state.phases['specify'].status = 'awaiting_review'
    expect(computeRunStatus(state)).toBe('awaiting_review')
  })

  it('reflects failed and completed run states', () => {
    const failed = createInitialState(featureDir, { run: { ...running, status: 'failed' } })
    expect(computeRunStatus(failed)).toBe('failed')
    const completed = createInitialState(featureDir, {
      run: { ...running, status: 'completed', completedAt: 'x' },
    })
    expect(computeRunStatus(completed)).toBe('completed')
  })
})

describe('buildCardSummary', () => {
  it('summarizes a backlog native card', () => {
    const state = createInitialState(featureDir, { card: createDefaultBrief('My card') })
    const summary = buildCardSummary(state, null)
    expect(summary.title).toBe('My card')
    expect(summary.stage).toBe('backlog')
    expect(summary.runStatus).toBe('none')
    expect(summary.phaseSummary.total).toBe(PHASE_ORDER.length)
    expect(summary.phaseSummary.done).toBe(0)
  })

  it('prefers the card.json brief over the state brief', () => {
    const state = createInitialState(featureDir, { card: createDefaultBrief('State title') })
    const card = createDefaultBrief('Card.json title')
    card.scope = 'Some scope line'
    expect(buildCardSummary(state, card).title).toBe('Card.json title')
    expect(buildCardSummary(state, card).scopeLine).toBe('Some scope line')
  })

  it('counts approved phases toward done', () => {
    const state = createInitialState(featureDir, { run: running })
    state.phases['constitution'].status = 'approved'
    state.phases['specify'].status = 'approved'
    expect(buildCardSummary(state, null).phaseSummary.done).toBe(2)
  })

  it('uses the persisted stage (user-controlled), not a derived one', () => {
    const state = createInitialState(featureDir)
    state.stage = 'done' // e.g. the user manually marked it done
    expect(buildCardSummary(state, null).stage).toBe('done')
  })
})
