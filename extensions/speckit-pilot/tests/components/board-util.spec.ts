import { describe, it, expect } from 'vitest'
import { bucketCards, resolveDrop } from '../../src/components/board-util.js'
import type { CardSummary } from '../../src/types/speckit.types.js'

function card(featureDir: string, stage: CardSummary['stage']): CardSummary {
  return {
    featureDir,
    title: featureDir,
    type: 'feature',
    scopeLine: '',
    source: 'native',
    sourceUrl: null,
    sourceKey: null,
    stage,
    runStatus: 'none',
    phaseSummary: { done: 0, total: 10, awaitingReview: false },
    prUrl: null,
  }
}

describe('bucketCards', () => {
  it('groups cards by stage with all four columns present', () => {
    const buckets = bucketCards([
      card('a', 'backlog'),
      card('b', 'in-progress'),
      card('c', 'backlog'),
    ])
    expect(Object.keys(buckets)).toEqual(['backlog', 'in-progress', 'in-review', 'done'])
    expect(buckets.backlog.map((c) => c.featureDir)).toEqual(['a', 'c'])
    expect(buckets['in-progress']).toHaveLength(1)
    expect(buckets.done).toEqual([])
  })
})

describe('resolveDrop', () => {
  const cards = [card('a', 'backlog'), card('b', 'in-progress')]

  it('resolves a move to any different stage', () => {
    expect(resolveDrop(cards, 'a', 'in-progress')).toEqual({
      featureDir: 'a',
      toStage: 'in-progress',
    })
    // non-adjacent moves are allowed — the board is the user's to organize
    expect(resolveDrop(cards, 'a', 'done')).toEqual({ featureDir: 'a', toStage: 'done' })
    expect(resolveDrop(cards, 'b', 'backlog')).toEqual({ featureDir: 'b', toStage: 'backlog' })
  })

  it('returns null for a no-op drop on the same column', () => {
    expect(resolveDrop(cards, 'a', 'backlog')).toBeNull()
  })

  it('returns null when the card is unknown', () => {
    expect(resolveDrop(cards, 'zzz', 'in-progress')).toBeNull()
  })
})
