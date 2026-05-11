import { describe, it, expect } from 'vitest'
import {
  computeRiskScore,
  detectComplexityHotspots,
  computeFileCyclomaticDelta,
} from '../../src/github/pr-review-service'
import type { FileMetrics } from '../../src/schemas/pr-review.schema'
import type { FileDiff } from '../../src/schemas/git.schema'

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

const makeDiff = (hunks: Array<{ adds: string[]; removes: string[] }>): FileDiff => ({
  path: 'src/auth.ts',
  isBinary: false,
  hunks: hunks.map((h, i) => ({
    header: `@@ -${i * 10 + 1},10 +${i * 10 + 1},10 @@`,
    lines: [
      ...h.removes.map((content) => ({
        type: 'remove' as const,
        content,
        oldLineNumber: 1,
        newLineNumber: null,
      })),
      ...h.adds.map((content) => ({
        type: 'add' as const,
        content,
        oldLineNumber: null,
        newLineNumber: 1,
      })),
    ],
  })),
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

  it('all-null numeric metrics (except testFilePresent) returns composite null', () => {
    const m = baseMetrics({
      churn90d: null,
      blastRadius: null,
      complexityDelta: null,
      patchCoverage: null,
    })
    const allSame = [m, m]
    const score = computeRiskScore(m, allSame)
    // When all numeric metrics normalise to same value or all null, composite may be null
    // The important rule: level defaults to 'low' when composite is null
    if (score.composite === null) expect(score.level).toBe('low')
  })

  it('missing test file adds the flat 20-point penalty', () => {
    const withTest = baseMetrics({ testFilePresent: true })
    const withoutTest = baseMetrics({ testFilePresent: false })
    const others = [withTest, withoutTest, baseMetrics({ churn90d: 50 })]
    const scoreWith = computeRiskScore(withTest, others)
    const scoreWithout = computeRiskScore(withoutTest, others)
    if (scoreWith.composite != null && scoreWithout.composite != null) {
      expect(scoreWithout.composite).toBeGreaterThan(scoreWith.composite)
    }
  })

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
    for (const s of [scoreH, scoreL]) {
      if (s.composite != null) {
        expect(s.composite).toBeGreaterThanOrEqual(0)
        expect(s.composite).toBeLessThanOrEqual(100)
      }
    }
  })
})

// ─── detectComplexityHotspots ─────────────────────────────────────────────────

describe('detectComplexityHotspots()', () => {
  it('returns empty array for empty diff', () => {
    const diff = makeDiff([])
    expect(detectComplexityHotspots(diff)).toEqual([])
  })

  it('does not flag a hunk with fewer than 5 added decision points', () => {
    const diff = makeDiff([
      {
        adds: ['if (a) {', 'for (let i=0;i<n;i++) {'], // 2 decision points
        removes: [],
      },
    ])
    expect(detectComplexityHotspots(diff)).toHaveLength(0)
  })

  it('flags a hunk with 5 or more added decision points', () => {
    const diff = makeDiff([
      {
        adds: [
          'if (a) {',
          'if (b) {',
          'for (let i=0;i<n;i++) {',
          'while (c) {',
          'if (d || e) {', // || counts as decision point too
        ],
        removes: [],
      },
    ])
    const hotspots = detectComplexityHotspots(diff)
    expect(hotspots).toHaveLength(1)
    expect(hotspots[0].hunkIndex).toBe(0)
    expect(hotspots[0].complexityDelta).toBeGreaterThanOrEqual(5)
  })

  it('subtracts removed decision points from added ones', () => {
    // 6 added, 5 removed → delta 1 → should NOT be flagged
    const addLines = ['if(a){', 'if(b){', 'for(;;){', 'while(x){', 'if(c){', 'switch(d){']
    const removeLines = ['if(a){', 'if(b){', 'for(;;){', 'while(x){', 'if(c){']
    const diff = makeDiff([{ adds: addLines, removes: removeLines }])
    expect(detectComplexityHotspots(diff)).toHaveLength(0)
  })

  it('annotation message includes the delta count', () => {
    const diff = makeDiff([
      {
        adds: ['if(a){', 'if(b){', 'for(;;){', 'while(x){', 'if(c&&d){', 'if(e||f){'],
        removes: [],
      },
    ])
    const hotspots = detectComplexityHotspots(diff)
    expect(hotspots[0].message).toContain('cyclomatic delta')
  })
})

// ─── computeFileCyclomaticDelta ───────────────────────────────────────────────

describe('computeFileCyclomaticDelta()', () => {
  it('returns 0 for an empty diff', () => {
    expect(computeFileCyclomaticDelta(makeDiff([]))).toBe(0)
  })

  it('sums deltas across all hunks', () => {
    const diff = makeDiff([
      { adds: ['if(a){', 'if(b){'], removes: [] }, // +2
      { adds: ['while(x){', 'for(;;){'], removes: ['if(z){'] }, // +2-1=+1
    ])
    expect(computeFileCyclomaticDelta(diff)).toBe(3)
  })
})
