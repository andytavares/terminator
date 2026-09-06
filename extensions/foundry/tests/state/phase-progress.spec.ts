import { describe, it, expect } from 'vitest'
import { completedSummary, nextStepLabel, phaseProgress } from '../../src/state/phase-progress'
import type { CardSummary } from '../../src/types/speckit.types'

// The board drew ten identical numbered circles and a 0/10 fraction. The names
// existed all along; nothing showed them, so reading your own board required
// having memorised that phase 4 is Plan.

const card = (over: Partial<CardSummary> = {}): CardSummary =>
  ({
    featureDir: 'specs/036-x',
    title: 'Make all text in the application red',
    type: 'feature',
    scopeLine: 'Every surface reads from one colour token.',
    source: 'native',
    sourceUrl: null,
    sourceKey: null,
    stage: 'backlog',
    runStatus: 'none',
    phaseSummary: { done: 0, total: 10, awaitingReview: false },
    prUrl: null,
    ...over,
  }) as CardSummary

describe('phaseProgress', () => {
  it('names the first phase when nothing has run', () => {
    expect(phaseProgress(card()).nextPhaseName).toBe('Constitution')
  })

  it('names the next phase part-way through', () => {
    const p = phaseProgress(card({ phaseSummary: { done: 3, total: 10, awaitingReview: false } }))
    expect(p.nextPhaseName).toBe('Plan')
    expect(p.done).toBe(3)
  })

  it('lists what is already finished', () => {
    const p = phaseProgress(card({ phaseSummary: { done: 2, total: 10, awaitingReview: false } }))
    expect(p.completedNames).toEqual(['Constitution', 'Specify'])
  })

  it('has no next phase once every one is finished', () => {
    const p = phaseProgress(card({ phaseSummary: { done: 10, total: 10, awaitingReview: false } }))
    expect(p.complete).toBe(true)
    expect(p.nextPhaseName).toBeNull()
  })

  // A summary can outrun the phase list if the pipeline changes under a card
  // mid-flight; indexing past the end would render "undefined".
  it('clamps a count beyond the total rather than reading past the end', () => {
    const p = phaseProgress(card({ phaseSummary: { done: 99, total: 10, awaitingReview: false } }))
    expect(p.done).toBe(10)
    expect(p.nextPhaseName).toBeNull()
  })

  it('clamps a negative count', () => {
    const p = phaseProgress(card({ phaseSummary: { done: -3, total: 10, awaitingReview: false } }))
    expect(p.done).toBe(0)
  })

  it('falls back to the known phase list when a total is missing', () => {
    const p = phaseProgress(card({ phaseSummary: { done: 0, total: 0, awaitingReview: false } }))
    expect(p.total).toBe(10)
  })
})

describe('nextStepLabel', () => {
  // The distinction the board exists for: waiting on you, or waiting on a
  // machine. Stated, rather than left to the colour of a dot.
  it('says what is next when nothing is running', () => {
    expect(
      nextStepLabel(card({ phaseSummary: { done: 3, total: 10, awaitingReview: false } }))
    ).toBe('Next: plan')
  })

  it('says a person is needed when review is pending', () => {
    expect(
      nextStepLabel(card({ phaseSummary: { done: 3, total: 10, awaitingReview: true } }))
    ).toBe('Review plan')
  })

  it('says what is running', () => {
    expect(
      nextStepLabel(
        card({ runStatus: 'running', phaseSummary: { done: 3, total: 10, awaitingReview: false } })
      )
    ).toBe('Running plan')
  })

  it('names the phase that failed', () => {
    expect(
      nextStepLabel(
        card({ runStatus: 'failed', phaseSummary: { done: 3, total: 10, awaitingReview: false } })
      )
    ).toBe('Plan failed')
  })

  it('says done when there is nothing left', () => {
    expect(
      nextStepLabel(card({ phaseSummary: { done: 10, total: 10, awaitingReview: false } }))
    ).toBe('Done')
  })

  // "Next: Plan" reads as a proper noun mid-phrase.
  it('lowercases the phase name inside a sentence', () => {
    expect(
      nextStepLabel(card({ phaseSummary: { done: 7, total: 10, awaitingReview: false } }))
    ).toBe('Next: implement')
  })
})

describe('completedSummary', () => {
  it('says nothing is done yet rather than listing an empty set', () => {
    expect(completedSummary(card())).toBe('Nothing done yet · 0 of 10')
  })

  it('names what is finished', () => {
    expect(
      completedSummary(card({ phaseSummary: { done: 2, total: 10, awaitingReview: false } }))
    ).toBe('2 of 10 · Constitution, Specify done')
  })
})
