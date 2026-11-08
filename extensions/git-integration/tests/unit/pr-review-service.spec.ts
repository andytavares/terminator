import { describe, it, expect } from 'vitest'
import {
  buildChapters,
  computeRiskScore,
  parseReviewQueuePR,
  queueRiskLevel,
  QUEUE_RISK_HIGH_LINES,
  QUEUE_RISK_MEDIUM_LINES,
  chapterRiskLevel,
  classifyHunk,
  extractIssueRefs,
  detectDryViolations,
  parsePrFileDiff,
} from '../../src/github/pr-review-service'
import { ReviewSessionSchema } from '../../src/schemas/pr-review.schema'
import type { PrChangedFile, FileMetrics } from '../../src/schemas/pr-review.schema'
import type { z } from 'zod'

// ─── Session persistence schema (T037) ───────────────────────────────────────

// A session as stored before v2: the fields v2 added are left to the schema's defaults.
const validSession: z.input<typeof ReviewSessionSchema> = {
  repoRoot: '/home/user/repo',
  prNumber: 42,
  headSHA: 'abc123',
  currentChapterId: 'src',
  currentFilePath: 'src/auth.ts',
  viewedFiles: ['src/auth.ts', 'src/types.ts'],
  fileOrderOverrides: { src: ['src/types.ts', 'src/auth.ts'] },
  scrollPosition: 250,
  pausedAt: '2026-05-07T12:00:00Z',
  lastAccessedAt: '2026-05-07T12:05:00Z',
}

describe('ReviewSessionSchema', () => {
  it('parses a valid session', () => {
    const result = ReviewSessionSchema.safeParse(validSession)
    expect(result.success).toBe(true)
  })

  it('accepts null currentChapterId and currentFilePath', () => {
    const result = ReviewSessionSchema.safeParse({
      ...validSession,
      currentChapterId: null,
      currentFilePath: null,
    })
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
})

describe('ReviewSessionSchema — rejects missing repoRoot', () => {
  it('rejects missing repoRoot', () => {
    const { repoRoot: _, ...rest } = validSession
    expect(ReviewSessionSchema.safeParse(rest).success).toBe(false)
  })
})

// ─── computeRiskScore branches ────────────────────────────────────────────────

function makeFileMetrics(overrides: Partial<FileMetrics> = {}): FileMetrics {
  return {
    path: 'src/foo.ts',
    additions: 10,
    deletions: 5,
    churn90d: null,
    blastRadius: null,
    testFilePresent: true,
    complexityDelta: null,
    patchCoverage: null,
    topImporters: [],
    importerCount: 0,
    ...overrides,
  }
}

describe('computeRiskScore() — patch coverage', () => {
  it('scores an uncovered file higher than the same file fully covered', () => {
    const other = makeFileMetrics({ churn90d: 0, blastRadius: 0 })
    const scoreAt = (patchCoverage: number) => {
      const metrics = makeFileMetrics({ churn90d: 5, blastRadius: 2, patchCoverage })
      return computeRiskScore(metrics, [metrics, other]).composite
    }
    expect([scoreAt(0), scoreAt(100)]).toEqual([59, 53])
  })
})

describe('computeRiskScore() — includes complexity delta in contributions when > 0', () => {
  it('names a complexity increase as the dominant driver when it outweighs the rest', () => {
    const metrics = makeFileMetrics({
      churn90d: 10,
      blastRadius: 5,
      complexityDelta: 8,
    })
    const allMetrics = [
      metrics,
      makeFileMetrics({ churn90d: 0, blastRadius: 0, complexityDelta: 0 }),
    ]
    const score = computeRiskScore(metrics, allMetrics)
    expect(score.dominantDriver).toBe('Complexity increase — +8 decision points')
  })

  it('normalise returns 0 when all values are equal (max === min)', () => {
    const metrics = makeFileMetrics({ churn90d: 5, blastRadius: 3 })
    const allMetrics = [
      metrics,
      makeFileMetrics({ churn90d: 5, blastRadius: 3 }), // same values
    ]
    const score = computeRiskScore(metrics, allMetrics)
    // normalise returns 0 when all values equal — churn_n and blast_n are 0
    expect(score.composite).toBe(0)
  })
})

// ─── queueRiskLevel thresholds ───────────────────────────────────────────────

describe('queueRiskLevel()', () => {
  it('flags a diff at the high threshold as high risk', () => {
    expect(queueRiskLevel(QUEUE_RISK_HIGH_LINES)).toBe('high')
  })

  it('does not flag a diff just below the high threshold as high', () => {
    expect(queueRiskLevel(QUEUE_RISK_HIGH_LINES - 1)).toBe('medium')
  })

  it('classifies a diff at the medium threshold as medium', () => {
    expect(queueRiskLevel(QUEUE_RISK_MEDIUM_LINES)).toBe('medium')
  })

  it('classifies a diff just below the medium threshold as low', () => {
    expect(queueRiskLevel(QUEUE_RISK_MEDIUM_LINES - 1)).toBe('low')
  })

  it('classifies an empty diff as low', () => {
    expect(queueRiskLevel(0)).toBe('low')
  })
})

// ─── parseReviewQueuePR branches ─────────────────────────────────────────────

describe('parseReviewQueuePR()', () => {
  it.each([
    ['OPEN', 'open'],
    ['MERGED', 'merged'],
    ['closed', 'closed'],
    [undefined, 'open'],
    ['SOMETHING', 'open'],
  ])('maps state %s to %s', (state, expected) => {
    expect(parseReviewQueuePR({ number: 1, title: 't', state }).state).toBe(expected)
  })

  it.each([
    [3000, 500, 'high'],
    [150, 50, 'medium'],
    [5, 2, 'low'],
  ])('rates a PR with %i additions and %i deletions as %s risk', (additions, deletions, level) => {
    const raw = { number: 100, title: 't', changedFiles: 1, additions, deletions }
    expect(parseReviewQueuePR(raw).riskLevel).toBe(level)
  })
})

describe('parseReviewQueuePR() — parses a PR with no files (uses changedFiles, additions, deletions from root)', () => {
  it('parses a PR with no files (uses changedFiles, additions, deletions from root)', () => {
    const raw = {
      number: 1,
      title: 'Test PR',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      changedFiles: 3,
      additions: 50,
      deletions: 10,
      statusCheckRollup: [],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.fileCount).toBe(3)
    expect(pr.additions).toBe(50)
    expect(pr.deletions).toBe(10)
    expect(pr.ciStatus).toBe('none')
  })
})

describe('parseReviewQueuePR() — parses a PR with files array (sums additions/deletions from files)', () => {
  it('parses a PR with files array (sums additions/deletions from files)', () => {
    const raw = {
      number: 2,
      title: 'PR with files',
      author: { login: 'bob', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'fix/bug',
      baseRefName: 'main',
      isDraft: true,
      files: [
        { path: 'src/a.ts', additions: 10, deletions: 5 },
        { path: 'src/b.ts', additions: 20, deletions: 3 },
      ],
      statusCheckRollup: null,
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.fileCount).toBe(2)
    expect(pr.additions).toBe(30)
    expect(pr.deletions).toBe(8)
    expect(pr.isDraft).toBe(true)
  })
})

describe('parseReviewQueuePR() — maps ciSignal=fail to ciStatus=failing', () => {
  it('maps ciSignal=fail to ciStatus=failing', () => {
    const raw = {
      number: 3,
      title: 'Failing CI',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      statusCheckRollup: [{ state: 'FAILURE' }],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.ciStatus).toBe('failing')
  })
})

describe('parseReviewQueuePR() — maps ciSignal=warn to ciStatus=pending', () => {
  it('maps ciSignal=warn to ciStatus=pending', () => {
    const raw = {
      number: 4,
      title: 'Pending CI',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      statusCheckRollup: [{ state: 'IN_PROGRESS' }],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.ciStatus).toBe('pending')
  })
})

describe('parseReviewQueuePR() — testsSignal returns fail when source files but no test files', () => {
  it('testsSignal returns fail when source files but no test files', () => {
    const raw = {
      number: 5,
      title: 'No tests',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      files: [{ path: 'src/service.ts', additions: 50, deletions: 0 }],
      statusCheckRollup: [],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.signalDots.tests).toBe('fail')
  })
})

describe('parseReviewQueuePR() — testsSignal returns pass when covered source files have test files', () => {
  it('testsSignal returns pass when covered source files have test files', () => {
    const raw = {
      number: 6,
      title: 'With tests',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      files: [
        { path: 'src/service.ts', additions: 50, deletions: 0 },
        { path: 'src/service.spec.ts', additions: 30, deletions: 0 },
      ],
      statusCheckRollup: [],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.signalDots.tests).toBe('pass')
  })
})

describe('parseReviewQueuePR() — churnSignal returns warn for perFile > 80', () => {
  it('churnSignal returns warn for perFile > 80', () => {
    // 1 file, 100 lines total → perFile = 100 > 80 → warn
    const raw = {
      number: 7,
      title: 'High churn',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      changedFiles: 1,
      additions: 90,
      deletions: 20,
      statusCheckRollup: [],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.signalDots.churn).toBe('warn')
  })
})

describe('parseReviewQueuePR() — churnSignal returns fail for perFile > 200', () => {
  it('churnSignal returns fail for perFile > 200', () => {
    const raw = {
      number: 8,
      title: 'Very high churn',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      changedFiles: 1,
      additions: 190,
      deletions: 50, // total 240 > 200
      statusCheckRollup: [],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.signalDots.churn).toBe('fail')
  })
})

describe('parseReviewQueuePR() — blastSignal returns warn for fileCount 7-15', () => {
  it('blastSignal returns warn for fileCount 7-15', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `src/file${i}.ts`,
      additions: 5,
      deletions: 2,
    }))
    const raw = {
      number: 9,
      title: 'Medium blast',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      files,
      statusCheckRollup: [],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.signalDots.blast).toBe('warn')
  })
})

describe('parseReviewQueuePR() — blastSignal returns fail for fileCount > 15', () => {
  it('blastSignal returns fail for fileCount > 15', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `src/file${i}.ts`,
      additions: 5,
      deletions: 0,
    }))
    const raw = {
      number: 10,
      title: 'High blast',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      files,
      statusCheckRollup: [],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.signalDots.blast).toBe('fail')
  })
})

describe('parseReviewQueuePR() — checkSignal returns warn for PENDING lint check', () => {
  it('checkSignal returns warn for PENDING lint check', () => {
    const raw = {
      number: 11,
      title: 'Pending lint',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      statusCheckRollup: [{ name: 'eslint', state: 'IN_PROGRESS' }],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.signalDots.lint).toBe('warn')
  })
})

describe('parseReviewQueuePR() — checkSignal returns fail for FAILURE lint check', () => {
  it('checkSignal returns fail for FAILURE lint check', () => {
    const raw = {
      number: 12,
      title: 'Failing lint',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      statusCheckRollup: [{ name: 'eslint', conclusion: 'FAILURE' }],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.signalDots.lint).toBe('fail')
  })
})

// ─── chapterRiskLevel ─────────────────────────────────────────────────────────

const makeChapterFile = (
  level: 'low' | 'medium' | 'high',
  tier: 0 | 1 | 2 | 3 = 1
): PrChangedFile => ({
  path: `src/file-${level}.ts`,
  changeType: 'modified',
  additions: 10,
  deletions: 2,
  isBinary: false,
  tier,
  whyHere: 'Source file',
  riskScore: {
    level,
    composite: level === 'high' ? 80 : level === 'medium' ? 50 : 10,
    metrics: {
      changeSize: null,
      churn90d: null,
      blastRadius: null,
      testFilePresent: null,
      complexityDelta: null,
      patchCoverage: null,
    },
    dominantDriver: '',
    topImporters: [],
    importerCount: 0,
  },
  estimatedMinutes: 1,
})

describe('chapterRiskLevel()', () => {
  it('returns high when any scoreable file is high', () => {
    const chapter = {
      id: 'ch-1',
      name: 'Chapter 1',
      estimatedMinutes: 10,
      status: 'not-started' as const,
      files: [makeChapterFile('low'), makeChapterFile('high'), makeChapterFile('medium')],
    }
    expect(chapterRiskLevel(chapter)).toBe('high')
  })

  it('returns medium when any scoreable file is medium (none high)', () => {
    const chapter = {
      id: 'ch-1',
      name: 'Chapter 1',
      estimatedMinutes: 10,
      status: 'not-started' as const,
      files: [makeChapterFile('low'), makeChapterFile('medium')],
    }
    expect(chapterRiskLevel(chapter)).toBe('medium')
  })
})

describe('chapterRiskLevel() — returns low when all scoreable files are low', () => {
  it('returns low when all scoreable files are low', () => {
    const chapter = {
      id: 'ch-1',
      name: 'Chapter 1',
      estimatedMinutes: 10,
      status: 'not-started' as const,
      files: [makeChapterFile('low'), makeChapterFile('low')],
    }
    expect(chapterRiskLevel(chapter)).toBe('low')
  })

  it('ignores tier-3 (mechanical) files in risk calculation', () => {
    const chapter = {
      id: 'ch-1',
      name: 'Chapter 1',
      estimatedMinutes: 10,
      status: 'not-started' as const,
      files: [
        makeChapterFile('high', 3), // tier 3 — excluded
        makeChapterFile('low', 1),
      ],
    }
    expect(chapterRiskLevel(chapter)).toBe('low')
  })
})

// ─── buildChapters — additional branch coverage ────────────────────────────

describe('buildChapters() — additional branches — handles file with explicit added/removed changeType', () => {
  it('handles file with explicit added/removed changeType', () => {
    const rawFiles = [
      { path: 'src/new-file.ts', additions: 50, deletions: 0, changeType: 'added' },
      { path: 'src/old-file.ts', additions: 0, deletions: 30, changeType: 'removed' },
    ]
    const chapters = buildChapters(rawFiles)
    const allFiles = chapters.flatMap((c) => c.files)
    const newFile = allFiles.find((f) => f.path === 'src/new-file.ts')
    const oldFile = allFiles.find((f) => f.path === 'src/old-file.ts')
    expect(newFile?.changeType).toBe('added')
    expect(oldFile?.changeType).toBe('deleted')
  })

  it('handles filename field instead of path', () => {
    const rawFiles = [{ filename: 'src/component.ts', additions: 10, deletions: 0 }]
    const chapters = buildChapters(rawFiles)
    expect(chapters[0].files[0].path).toBe('src/component.ts')
  })
})

describe('buildChapters() — additional branches — uses co-change affinity to group files across directories', () => {
  it('uses co-change affinity to group files across directories', () => {
    const coChangeAffinity = new Map([
      ['cmd/server/main.go', ['internal/handler/user.go']],
      ['internal/handler/user.go', ['cmd/server/main.go']],
    ])
    const rawFiles = [
      { path: 'cmd/server/main.go', additions: 10, deletions: 0 },
      { path: 'internal/handler/user.go', additions: 5, deletions: 0 },
      { path: 'docs/readme.md', additions: 3, deletions: 0 },
    ]
    const chapters = buildChapters(rawFiles, undefined, coChangeAffinity)
    // The two co-changing Go files should be in the same chapter
    const goChapter = chapters.find(
      (c) =>
        c.files.some((f) => f.path === 'cmd/server/main.go') &&
        c.files.some((f) => f.path === 'internal/handler/user.go')
    )
    expect(goChapter).toBeTruthy()
  })
})

// ─── classifyHunk ─────────────────────────────────────────────────────────────

describe('classifyHunk', () => {
  it('returns semantic for hunk with only context lines', () => {
    const hunk = {
      lines: [{ type: 'context', content: 'const x = 1' }],
    }
    expect(classifyHunk(hunk)).toBe('semantic')
  })

  it('returns semantic when add and remove counts differ', () => {
    const hunk = {
      lines: [
        { type: 'add', content: 'const x = 1' },
        { type: 'add', content: 'const y = 2' },
        { type: 'remove', content: 'const z = 3' },
      ],
    }
    expect(classifyHunk(hunk)).toBe('semantic')
  })
})

describe('classifyHunk — returns formatting when add and remove are whitespace variants of each other', () => {
  it('returns formatting when add and remove are whitespace variants of each other', () => {
    const hunk = {
      lines: [
        { type: 'remove', content: 'const x = 1' },
        { type: 'add', content: '  const x = 1' },
      ],
    }
    expect(classifyHunk(hunk)).toBe('formatting')
  })

  it('returns semantic when content differs meaningfully', () => {
    const hunk = {
      lines: [
        { type: 'remove', content: 'const x = 1' },
        { type: 'add', content: 'const x = 2' },
      ],
    }
    expect(classifyHunk(hunk)).toBe('semantic')
  })
})

describe('classifyHunk — returns formatting for reordered import lines', () => {
  it('returns formatting for reordered import lines', () => {
    const hunk = {
      lines: [
        { type: 'remove', content: "import { a } from './a'" },
        { type: 'remove', content: "import { b } from './b'" },
        { type: 'add', content: "import { b } from './b'" },
        { type: 'add', content: "import { a } from './a'" },
      ],
    }
    expect(classifyHunk(hunk)).toBe('formatting')
  })
})

// ─── extractIssueRefs ─────────────────────────────────────────────────────────

describe('extractIssueRefs', () => {
  it('extracts GitHub issue references', () => {
    const body = 'Fixes #123\nCloses #456'
    const refs = extractIssueRefs(body)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual({ type: 'github', ref: '#123' })
    expect(refs[1]).toEqual({ type: 'github', ref: '#456' })
  })

  it('extracts Linear issue URLs', () => {
    const body = 'Fixes https://linear.app/myteam/issue/TEAM-123 some extra text'
    const refs = extractIssueRefs(body)
    expect(refs.some((r) => r.type === 'linear' && r.ref === 'TEAM-123')).toBe(true)
  })

  it('returns empty array for body with no refs', () => {
    expect(extractIssueRefs('Just a description')).toHaveLength(0)
  })

  it('handles case-insensitive keywords', () => {
    const refs = extractIssueRefs('FIXES #99 RESOLVES #100')
    expect(refs).toHaveLength(2)
  })
})

// ─── detectDryViolations ──────────────────────────────────────────────────────

describe('detectDryViolations', () => {
  it('returns empty array when no patches provided', () => {
    const result = detectDryViolations([{ path: 'a.ts' }, { path: 'b.ts' }])
    expect(result).toHaveLength(0)
  })

  it('detects duplicate added blocks across files', () => {
    const sharedBlock = Array.from(
      { length: 5 },
      (_, i) => `+  const handler${i} = () => doSomethingWithThisLongLine${i}()`
    ).join('\n')
    const files = [
      { path: 'src/a.ts', patch: sharedBlock },
      { path: 'src/b.ts', patch: sharedBlock },
    ]
    const violations = detectDryViolations(files)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].files).toContain('src/a.ts')
    expect(violations[0].files).toContain('src/b.ts')
  })

  it('returns no violations when blocks are unique', () => {
    const files = [
      { path: 'src/a.ts', patch: '+const uniqueA = doSomethingSpecificToFileA()' },
      { path: 'src/b.ts', patch: '+const uniqueB = doSomethingSpecificToFileB()' },
    ]
    expect(detectDryViolations(files)).toHaveLength(0)
  })
})

// ─── multi-language classifyTier ──────────────────────────────────────────────

describe('buildChapters tier classification for multiple languages', () => {
  const makeFile = (path: string) => ({ path, additions: 5, deletions: 0 })

  it.each([
    ['src/user_test.go', 2],
    ['tests/test_service.py', 2],
    ['conftest.py', 2],
    ['spec/user_spec.rb', 2],
    ['UserTest.java', 2],
    ['UserTests.swift', 2],
    ['tests/integration_test.rs', 2],
  ])('classifies %s as tier %i', (path, expectedTier) => {
    const chapters = buildChapters([makeFile(path)])
    const file = chapters.flatMap((c) => c.files).find((f) => f.path === path)
    expect(file?.tier).toBe(expectedTier)
  })
})

describe('extractIssueRefs — Jira', () => {
  it('finds a Jira browse URL', async () => {
    const { extractIssueRefs } = await import('../../src/github/pr-review-service')
    const refs = extractIssueRefs('Fixes https://tav.atlassian.net/browse/TAV-7 today')
    expect(refs).toContainEqual({
      type: 'jira',
      ref: 'TAV-7',
      url: 'https://tav.atlassian.net/browse/TAV-7',
    })
  })

  it('still finds GitHub and Linear references alongside it', async () => {
    const { extractIssueRefs } = await import('../../src/github/pr-review-service')
    const refs = extractIssueRefs(
      'Closes #12, https://linear.app/tav/issue/TAV-42 and https://tav.atlassian.net/browse/TAV-7'
    )
    expect(refs.map((r) => r.type).sort()).toEqual(['github', 'jira', 'linear'])
  })
})

const LINEAR_REF = {
  type: 'linear' as const,
  ref: 'TAV-42',
  url: 'https://linear.app/tav/issue/TAV-42',
}

describe('enrichIssueRefs (FR-030)', () => {
  it('fills in the title and state a bare key does not carry', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = {
      get: vi
        .fn()
        .mockResolvedValue({ title: 'Unify connections', state: { name: 'In Progress' } }),
    }

    const [enriched] = await enrichIssueRefs([LINEAR_REF], issues)

    expect(issues.get).toHaveBeenCalledWith('linear', 'TAV-42')
    expect(enriched).toMatchObject({ title: 'Unify connections', state: 'In Progress' })
  })

  it('leaves GitHub references alone — they are not a tracker issue', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = { get: vi.fn() }

    const [enriched] = await enrichIssueRefs([{ type: 'github' as const, ref: '#12' }], issues)

    expect(issues.get).not.toHaveBeenCalled()
    expect(enriched).toEqual({ type: 'github', ref: '#12' })
  })
})

describe('enrichIssueRefs (FR-030) — renders exactly as today when the tracker cannot be reached', () => {
  it('renders exactly as today when the tracker cannot be reached', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = { get: vi.fn().mockRejectedValue(new Error('not connected')) }

    const [enriched] = await enrichIssueRefs([LINEAR_REF], issues)

    // Best-effort by design: a review must not fail because a tracker did.
    expect(enriched).toEqual(LINEAR_REF)
  })

  it('leaves a reference alone when the issue no longer exists', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = { get: vi.fn().mockResolvedValue(null) }

    const [enriched] = await enrichIssueRefs([LINEAR_REF], issues)
    expect(enriched).toEqual(LINEAR_REF)
  })
})

describe('enrichIssueRefs (FR-030) — Jira references', () => {
  it('leaves a Jira reference as found without asking a tracker', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = {
      get: vi.fn().mockResolvedValue({ title: 'Move Jira over', state: { name: 'Done' } }),
    }

    await enrichIssueRefs([{ type: 'jira' as const, ref: 'TAV-7' }], issues)
    expect(issues.get).not.toHaveBeenCalled()
  })
})

describe('enrichIssueRefs — no tracker available', () => {
  it('returns references untouched when the host offers no issues namespace', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const refs = [
      { type: 'linear' as const, ref: 'TAV-42', url: 'https://linear.app/tav/issue/TAV-42' },
      { type: 'github' as const, ref: '#12' },
    ]
    // An older host has no api.issues; the review view must render exactly as
    // it always did rather than failing.
    await expect(enrichIssueRefs(refs, undefined)).resolves.toEqual(refs)
  })
})

const head = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n'

const flat = (raw: string) =>
  parsePrFileDiff(raw, 'x').hunks.flatMap((h) =>
    h.lines.map((l) => [l.type, l.content, l.oldLineNumber, l.newLineNumber])
  )

describe('parsePrFileDiff — patch content that looks like a file header', () => {
  it('counts a removed `--- x` line and an added `+++i;` line as content, not headers', () => {
    const raw = `${head}@@ -1,3 +1,3 @@\n a\n--- x\n+++i;\n z\n`
    expect(flat(raw)).toEqual([
      ['context', 'a', 1, 1],
      ['remove', '-- x', 2, null],
      ['add', '++i;', null, 2],
      ['context', 'z', 3, 3],
    ])
  })
})

describe('parsePrFileDiff', () => {
  it('drops the "No newline at end of file" marker and the trailing empty element', () => {
    const raw = `${head}@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n`
    expect(flat(raw)).toEqual([
      ['context', 'a', 1, 1],
      ['remove', 'b', 2, null],
      ['add', 'c', null, 2],
    ])
  })

  it('keeps a genuinely blank context line (a single space) mid-hunk', () => {
    const raw = `${head}@@ -1,3 +1,3 @@\n a\n \n-b\n+c\n`
    expect(flat(raw)).toEqual([
      ['context', 'a', 1, 1],
      ['context', '', 2, 2],
      ['remove', 'b', 3, null],
      ['add', 'c', null, 3],
    ])
  })
})

describe('parseDiff — numbers a second hunk from its own header', () => {
  it('numbers a second hunk from its own header', () => {
    const raw = `${head}@@ -1,1 +1,1 @@\n a\n@@ -10,2 +20,2 @@\n-x\n+y\n z\n`
    const hunks = parsePrFileDiff(raw, 'x').hunks
    expect(hunks).toHaveLength(2)
    expect(hunks[1].lines.map((l) => [l.oldLineNumber, l.newLineNumber])).toEqual([
      [10, null],
      [null, 20],
      [11, 21],
    ])
  })
})
