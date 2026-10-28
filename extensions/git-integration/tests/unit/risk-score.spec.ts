import { describe, it, expect } from 'vitest'
import { computeRiskScore } from '../../src/github/pr-review-service'
import type { FileMetrics } from '../../src/schemas/pr-review.schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const baseMetrics = (overrides: Partial<FileMetrics> = {}): FileMetrics => ({
  path: 'src/auth.ts',
  additions: 50,
  deletions: 10,
  churn90d: 20,
  blastRadius: 15,
  testFilePresent: true,
  complexityDelta: 2,
  patchCoverage: null,
  topImporters: ['src/app.ts', 'src/index.ts'],
  importerCount: 2,
  ...overrides,
})

// ─── computeRiskScore ─────────────────────────────────────────────────────────

describe('computeRiskScore()', () => {
  it('returns low risk when all metrics are minimal', () => {
    const low = baseMetrics({
      churn90d: 1,
      blastRadius: 1,
      additions: 5,
      deletions: 0,
      testFilePresent: true,
      complexityDelta: 0,
    })
    const others = [
      low,
      baseMetrics({ churn90d: 50, blastRadius: 100, additions: 300, deletions: 50 }),
    ]
    const score = computeRiskScore(low, others)
    expect(score.level).toBe('low')
  })
})

describe('computeRiskScore() — returns high risk for the most extreme file in the set', () => {
  it('returns high risk for the most extreme file in the set', () => {
    const high = baseMetrics({
      churn90d: 100,
      blastRadius: 200,
      additions: 500,
      deletions: 100,
      testFilePresent: false,
      complexityDelta: 20,
    })
    const others = [high, baseMetrics({ churn90d: 1, blastRadius: 1, additions: 5, deletions: 0 })]
    const score = computeRiskScore(high, others)
    expect(score.level).toBe('high')
    expect(score.composite).not.toBeNull()
    expect(score.composite!).toBeGreaterThan(66)
  })
})

describe('computeRiskScore() — all-null numeric metrics (except testFilePresent) returns composite null', () => {
  it('all-null numeric metrics (except testFilePresent) returns composite null', () => {
    const m = baseMetrics({
      churn90d: null,
      blastRadius: null,
      complexityDelta: null,
      patchCoverage: null,
    })
    const allSame = [m, m]
    const score = computeRiskScore(m, allSame)
    expect(score.composite).toBeNull()
    expect(score.level).toBe('low')
  })

  it('missing test file adds the flat 20-point penalty', () => {
    const withTest = baseMetrics({ testFilePresent: true })
    const withoutTest = baseMetrics({ testFilePresent: false })
    const others = [withTest, withoutTest, baseMetrics({ churn90d: 50 })]
    const scoreWith = computeRiskScore(withTest, others)
    const scoreWithout = computeRiskScore(withoutTest, others)
    expect(scoreWith.composite).toBe(0)
    expect(scoreWithout.composite).toBe(20)
  })
})

describe('computeRiskScore() — sets dominantDriver to a non-empty string', () => {
  it('sets dominantDriver to a non-empty string', () => {
    const m = baseMetrics()
    const score = computeRiskScore(m, [m])
    expect(typeof score.dominantDriver).toBe('string')
    expect(score.dominantDriver.length).toBeGreaterThan(0)
  })

  it('topImporters is capped at 5', () => {
    const m = baseMetrics({
      topImporters: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      importerCount: 7,
    })
    const score = computeRiskScore(m, [m])
    expect(score.topImporters.length).toBeLessThanOrEqual(5)
  })
})

describe('computeRiskScore() — composite is between 0 and 100', () => {
  it('composite is between 0 and 100', () => {
    const high = baseMetrics({
      churn90d: 200,
      blastRadius: 500,
      additions: 1000,
      deletions: 200,
      testFilePresent: false,
    })
    const low = baseMetrics({
      churn90d: 0,
      blastRadius: 0,
      additions: 1,
      deletions: 0,
      testFilePresent: true,
    })
    const both = [high, low]
    const scoreH = computeRiskScore(high, both)
    const scoreL = computeRiskScore(low, both)
    expect(scoreH.composite).toBe(90)
    expect(scoreL.composite).toBe(0)
  })
})

// ─── Absolute risk levels ─────────────────────────────────────────────────────

const small = baseMetrics({
  additions: 3,
  deletions: 0,
  churn90d: 2,
  blastRadius: 1,
  complexityDelta: 0,
})
const smaller = baseMetrics({
  additions: 1,
  deletions: 0,
  churn90d: 1,
  blastRadius: 0,
  complexityDelta: 0,
})

describe('computeRiskScore() — level comes from fixed thresholds, not from the neighbours', () => {
  it('rates both files of a tiny two-file change low, with no "High" label', () => {
    for (const file of [small, smaller]) {
      const score = computeRiskScore(file, [small, smaller])
      expect(score.level).toBe('low')
      expect(score.dominantDriver).not.toMatch(/^(High|Wide|Large)/)
    }
  })

  it('says no signal crossed its threshold when nothing is over a floor', () => {
    const score = computeRiskScore(small, [small, smaller])
    expect(score.dominantDriver).toBe('No risk signal over its threshold')
  })

  it('rates 31 commits in 90 days medium whatever the neighbours are', () => {
    const busy = baseMetrics({ ...small, churn90d: 31 })
    const extreme = baseMetrics({ churn90d: 500, blastRadius: 900, additions: 9000 })
    expect(computeRiskScore(busy, [busy]).level).toBe('medium')
    expect(computeRiskScore(busy, [busy, extreme]).level).toBe('medium')
  })

  it('rates 55 commits in 90 days high and names the churn', () => {
    const score = computeRiskScore(baseMetrics({ ...small, churn90d: 55 }), [small])
    expect(score.level).toBe('high')
    expect(score.dominantDriver).toBe('Changes often — 55 commits in 90 days')
  })
})

describe('computeRiskScore() — absolute floors and wording', () => {
  it('rates the blast radius and change size floors', () => {
    expect(computeRiskScore(baseMetrics({ ...small, blastRadius: 10 }), [small]).level).toBe(
      'medium'
    )
    expect(computeRiskScore(baseMetrics({ ...small, blastRadius: 20 }), [small]).level).toBe('high')
    expect(computeRiskScore(baseMetrics({ ...small, additions: 150 }), [small]).level).toBe(
      'medium'
    )
    expect(computeRiskScore(baseMetrics({ ...small, additions: 400 }), [small]).level).toBe('high')
  })

  it('words a single commit and a single importer in the singular', () => {
    const score = computeRiskScore(smaller, [smaller, small])
    expect(JSON.stringify(score)).not.toContain('1 commits')
    const lone = baseMetrics({ ...small, churn90d: 1, testFilePresent: false })
    expect(computeRiskScore(lone, [lone, small]).dominantDriver).toBe('Missing test file')
  })

  it('labels a large change by its line count', () => {
    const big = baseMetrics({ ...small, additions: 412, deletions: 0 })
    expect(computeRiskScore(big, [big]).dominantDriver).toBe('Large change — 412 lines')
  })
})
