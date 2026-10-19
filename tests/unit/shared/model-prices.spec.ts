import { describe, it, expect } from 'vitest'
import { estimateCostUsd, costOfModels } from '../../../src/shared/agents/model-prices'

const MILLION = {
  input: 1_000_000,
  output: 1_000_000,
  cacheCreation: 1_000_000,
  cacheRead: 1_000_000,
}

describe('estimateCostUsd', () => {
  it('prices a model with the default cache factors', () => {
    // 5 + 25 + 1.25*5 + 0.1*5
    expect(estimateCostUsd('claude-opus-4-8', MILLION)).toBeCloseTo(36.75)
  })

  it('uses the explicit cache read price for Opus 5.5, Sonnet 5.5 and Fable 5.1', () => {
    const cacheOnly = { input: 0, output: 0, cacheCreation: 0, cacheRead: 1_000_000 }
    expect(estimateCostUsd('claude-opus-5-5', cacheOnly)).toBeCloseTo(0.2)
    expect(estimateCostUsd('claude-sonnet-5-5', cacheOnly)).toBeCloseTo(0.2)
    expect(estimateCostUsd('claude-fable-5-1', cacheOnly)).toBeCloseTo(0.25)
    expect(estimateCostUsd('claude-fable-5', cacheOnly)).toBeCloseTo(1)
  })

  it('matches the longest prefix, so a dated Opus 5.5 is not priced as Opus 5', () => {
    const input = { input: 1_000_000, output: 0, cacheCreation: 0, cacheRead: 0 }
    expect(estimateCostUsd('claude-opus-5-5-20261001', input)).toBe(4)
    expect(estimateCostUsd('claude-opus-5-20261001', input)).toBe(5)
  })

  it('returns null for an unknown model', () => {
    expect(estimateCostUsd('mystery-model-1', MILLION)).toBeNull()
  })
})

describe('costOfModels', () => {
  it('adds known models and marks the total partial when one is unknown', () => {
    const one = { input: 1_000_000, output: 0, cacheCreation: 0, cacheRead: 0 }
    expect(costOfModels({ 'claude-haiku-4-5': one })).toEqual({ costUsd: 1, costIsPartial: false })
    expect(costOfModels({ 'claude-haiku-4-5': one, mystery: one })).toEqual({
      costUsd: 1,
      costIsPartial: true,
    })
  })
})
