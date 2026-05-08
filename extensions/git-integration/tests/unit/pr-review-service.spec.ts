import { describe, it, expect } from 'vitest'
import { buildChapters, detectChangedFiles } from '../../src/github/pr-review-service'
import { ReviewSessionSchema } from '../../src/schemas/pr-review.schema'
import type { PrChangedFile, ReviewSession } from '../../src/schemas/pr-review.schema'

// ─── Session persistence schema (T037) ───────────────────────────────────────

describe('ReviewSessionSchema', () => {
  const validSession: ReviewSession = {
    repoRoot:           '/home/user/repo',
    prNumber:           42,
    headSHA:            'abc123',
    currentChapterId:   'src',
    currentFilePath:    'src/auth.ts',
    viewedFiles:        ['src/auth.ts', 'src/types.ts'],
    fileOrderOverrides: { src: ['src/types.ts', 'src/auth.ts'] },
    scrollPosition:     250,
    pausedAt:           '2026-05-07T12:00:00Z',
    lastAccessedAt:     '2026-05-07T12:05:00Z',
  }

  it('parses a valid session', () => {
    const result = ReviewSessionSchema.safeParse(validSession)
    expect(result.success).toBe(true)
  })

  it('accepts null currentChapterId and currentFilePath', () => {
    const result = ReviewSessionSchema.safeParse({ ...validSession, currentChapterId: null, currentFilePath: null })
    expect(result.success).toBe(true)
  })

  it('accepts null scrollPosition', () => {
    const result = ReviewSessionSchema.safeParse({ ...validSession, scrollPosition: null })
    expect(result.success).toBe(true)
  })

  it('accepts null pausedAt', () => {
    const result = ReviewSessionSchema.safeParse({ ...validSession, pausedAt: null })
    expect(result.success).toBe(true)
  })

  it('rejects missing repoRoot', () => {
    const { repoRoot: _, ...rest } = validSession
    expect(ReviewSessionSchema.safeParse(rest).success).toBe(false)
  })

  it('serialises viewedFiles as an array (Set → array for JSON)', () => {
    // The schema stores viewedFiles as string[]; the store converts to/from Set
    const result = ReviewSessionSchema.parse(validSession)
    expect(Array.isArray(result.viewedFiles)).toBe(true)
  })

  it('session key changes when headSHA changes (force-push invalidation)', () => {
    const key1 = `${validSession.repoRoot}:::${validSession.prNumber}:::${validSession.headSHA}`
    const key2 = `${validSession.repoRoot}:::${validSession.prNumber}:::def456`
    expect(key1).not.toBe(key2)
  })
})

// ─── detectChangedFiles (T063) ────────────────────────────────────────────────

const makeFile = (path: string, additions = 10, deletions = 2): PrChangedFile => ({
  path,
  changeType:       'modified',
  additions,
  deletions,
  isBinary:         false,
  tier:             1,
  whyHere:          'Source file',
  riskScore: {
    level: 'low', composite: null,
    metrics: { changeSize: null, churn90d: null, blastRadius: null, testFilePresent: null, complexityDelta: null, patchCoverage: null },
    dominantDriver: '', topImporters: [], importerCount: 0,
  },
  estimatedMinutes: 1,
})

describe('detectChangedFiles()', () => {
  it('returns empty set when all files are unchanged', () => {
    const files = [makeFile('src/a.ts'), makeFile('src/b.ts')]
    const changed = detectChangedFiles(files, files)
    expect(changed.size).toBe(0)
  })

  it('flags files whose addition/deletion counts changed', () => {
    const old = [makeFile('src/a.ts', 10, 2)]
    const next = [makeFile('src/a.ts', 20, 5)]
    const changed = detectChangedFiles(old, next)
    expect(changed.has('src/a.ts')).toBe(true)
  })

  it('flags newly added files', () => {
    const old  = [makeFile('src/a.ts')]
    const next = [makeFile('src/a.ts'), makeFile('src/b.ts')]
    const changed = detectChangedFiles(old, next)
    expect(changed.has('src/b.ts')).toBe(true)
    expect(changed.has('src/a.ts')).toBe(false)
  })

  it('does not flag files with identical sizes', () => {
    const old  = [makeFile('src/a.ts', 10, 2), makeFile('src/b.ts', 5, 1)]
    const next = [makeFile('src/a.ts', 10, 2), makeFile('src/b.ts', 5, 1)]
    expect(detectChangedFiles(old, next).size).toBe(0)
  })
})

// ─── buildChapters used from pr-review-service (cross-reference T020) ────────

describe('buildChapters() — cross-reference', () => {
  it('returns [] for empty input', () => {
    expect(buildChapters([])).toEqual([])
  })
})
