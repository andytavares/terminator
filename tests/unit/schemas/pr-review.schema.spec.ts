import { describe, it, expect } from 'vitest'
import {
  SignalDotsSchema,
  RiskScoreSchema,
  FileMetricsSchema,
  PrChangedFileSchema,
  ChapterSchema,
  ReviewQueuePRSchema,
  ReviewSessionSchema,
  InlineCommentSchema,
  ThreadSchema,
} from '../../../src/shared/schemas/pr-review.schema'

const validSignalDots = {
  tests: 'pass' as const,
  coverage: 'warn' as const,
  ci: 'pass' as const,
  lint: 'pass' as const,
  churn: 'unknown' as const,
  blast: 'fail' as const,
}

const validRiskScore = {
  level: 'medium' as const,
  composite: 42,
  metrics: {
    changeSize: 100,
    churn90d: 5,
    blastRadius: 3,
    testFilePresent: true,
    complexityDelta: 2,
    patchCoverage: 80,
  },
  dominantDriver: 'changeSize',
  topImporters: ['src/app.ts'],
  importerCount: 1,
}

const validFileMetrics = {
  path: 'src/app.ts',
  additions: 10,
  deletions: 5,
  churn90d: null,
  blastRadius: 2,
  testFilePresent: true,
  complexityDelta: null,
  patchCoverage: null,
  topImporters: [],
  importerCount: 0,
}

const validPrChangedFile = {
  path: 'src/app.ts',
  changeType: 'modified' as const,
  additions: 10,
  deletions: 5,
  isBinary: false,
  tier: 1 as const,
  whyHere: 'modified core logic',
  riskScore: validRiskScore,
  estimatedMinutes: 5,
}

const validChapter = {
  id: 'ch-1',
  name: 'Core Changes',
  files: [validPrChangedFile],
  estimatedMinutes: 10,
  status: 'not-started' as const,
}

const validReviewQueuePR = {
  number: 42,
  title: 'Fix: resolve memory leak',
  author: 'alice',
  authorAvatarUrl: 'https://example.com/alice.png',
  openedAt: '2024-01-01T00:00:00Z',
  headRefName: 'fix/memory-leak',
  baseRefName: 'main',
  isDraft: false,
  ciStatus: 'passing' as const,
  fileCount: 3,
  additions: 100,
  deletions: 50,
  estimatedMinutes: 15,
  riskLevel: 'low' as const,
  signalDots: validSignalDots,
  sessionStatus: 'not-started' as const,
}

describe('SignalDotsSchema', () => {
  it('accepts valid signal dots', () => {
    expect(SignalDotsSchema.safeParse(validSignalDots).success).toBe(true)
  })

  it('accepts all signal values', () => {
    for (const val of ['pass', 'warn', 'fail', 'unknown'] as const) {
      const dots = { ...validSignalDots, tests: val }
      expect(SignalDotsSchema.safeParse(dots).success).toBe(true)
    }
  })

  it('rejects invalid signal value', () => {
    expect(SignalDotsSchema.safeParse({ ...validSignalDots, ci: 'error' }).success).toBe(false)
  })
})

describe('RiskScoreSchema', () => {
  it('accepts valid risk score', () => {
    expect(RiskScoreSchema.safeParse(validRiskScore).success).toBe(true)
  })

  it('accepts null composite', () => {
    const score = { ...validRiskScore, composite: null }
    expect(RiskScoreSchema.safeParse(score).success).toBe(true)
  })

  it('accepts all risk levels', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(RiskScoreSchema.safeParse({ ...validRiskScore, level }).success).toBe(true)
    }
  })

  it('rejects invalid risk level', () => {
    expect(RiskScoreSchema.safeParse({ ...validRiskScore, level: 'critical' }).success).toBe(false)
  })

  it('accepts null metric values', () => {
    const score = {
      ...validRiskScore,
      metrics: {
        changeSize: null,
        churn90d: null,
        blastRadius: null,
        testFilePresent: null,
        complexityDelta: null,
        patchCoverage: null,
      },
    }
    expect(RiskScoreSchema.safeParse(score).success).toBe(true)
  })
})

describe('FileMetricsSchema', () => {
  it('accepts valid file metrics', () => {
    expect(FileMetricsSchema.safeParse(validFileMetrics).success).toBe(true)
  })

  it('requires path string', () => {
    expect(FileMetricsSchema.safeParse({ ...validFileMetrics, path: 123 }).success).toBe(false)
  })
})

describe('PrChangedFileSchema', () => {
  it('accepts valid changed file', () => {
    expect(PrChangedFileSchema.safeParse(validPrChangedFile).success).toBe(true)
  })

  it('accepts renamed file with oldPath', () => {
    const file = { ...validPrChangedFile, changeType: 'renamed' as const, oldPath: 'src/old.ts' }
    expect(PrChangedFileSchema.safeParse(file).success).toBe(true)
  })

  it('accepts all change types', () => {
    for (const changeType of ['added', 'modified', 'deleted', 'renamed'] as const) {
      expect(PrChangedFileSchema.safeParse({ ...validPrChangedFile, changeType }).success).toBe(
        true
      )
    }
  })

  it('accepts all tier values', () => {
    for (const tier of [0, 1, 2, 3] as const) {
      expect(PrChangedFileSchema.safeParse({ ...validPrChangedFile, tier }).success).toBe(true)
    }
  })

  it('rejects invalid tier', () => {
    expect(PrChangedFileSchema.safeParse({ ...validPrChangedFile, tier: 4 }).success).toBe(false)
  })
})

describe('ChapterSchema', () => {
  it('accepts valid chapter', () => {
    expect(ChapterSchema.safeParse(validChapter).success).toBe(true)
  })

  it('accepts all chapter statuses', () => {
    for (const status of ['not-started', 'in-progress', 'complete'] as const) {
      expect(ChapterSchema.safeParse({ ...validChapter, status }).success).toBe(true)
    }
  })

  it('accepts chapter with no files', () => {
    expect(ChapterSchema.safeParse({ ...validChapter, files: [] }).success).toBe(true)
  })
})

describe('ReviewQueuePRSchema', () => {
  it('accepts valid review queue PR', () => {
    expect(ReviewQueuePRSchema.safeParse(validReviewQueuePR).success).toBe(true)
  })

  it('accepts all CI statuses', () => {
    for (const ciStatus of ['passing', 'failing', 'pending', 'none'] as const) {
      expect(ReviewQueuePRSchema.safeParse({ ...validReviewQueuePR, ciStatus }).success).toBe(true)
    }
  })

  it('accepts optional resumeChapter fields', () => {
    const pr = { ...validReviewQueuePR, resumeChapter: 2, resumeChapterTotal: 5 }
    expect(ReviewQueuePRSchema.safeParse(pr).success).toBe(true)
  })

  it('accepts draft PRs', () => {
    expect(ReviewQueuePRSchema.safeParse({ ...validReviewQueuePR, isDraft: true }).success).toBe(
      true
    )
  })

  it('rejects non-numeric PR number', () => {
    expect(
      ReviewQueuePRSchema.safeParse({ ...validReviewQueuePR, number: 'forty-two' }).success
    ).toBe(false)
  })
})

describe('ReviewSessionSchema', () => {
  const validSession = {
    repoRoot: '/home/user/project',
    prNumber: 42,
    headSHA: 'abc1234',
    currentChapterId: 'ch-1',
    currentFilePath: 'src/app.ts',
    viewedFiles: ['src/app.ts'],
    fileOrderOverrides: { 'ch-1': ['src/a.ts', 'src/b.ts'] },
    scrollPosition: 100,
    pausedAt: null,
    lastAccessedAt: '2024-01-01T00:00:00.000Z',
  }

  it('accepts valid session', () => {
    expect(ReviewSessionSchema.safeParse(validSession).success).toBe(true)
  })

  it('accepts null currentChapterId', () => {
    expect(ReviewSessionSchema.safeParse({ ...validSession, currentChapterId: null }).success).toBe(
      true
    )
  })

  it('accepts null currentFilePath', () => {
    expect(ReviewSessionSchema.safeParse({ ...validSession, currentFilePath: null }).success).toBe(
      true
    )
  })

  it('accepts null scrollPosition', () => {
    expect(ReviewSessionSchema.safeParse({ ...validSession, scrollPosition: null }).success).toBe(
      true
    )
  })

  it('accepts non-null pausedAt timestamp', () => {
    expect(
      ReviewSessionSchema.safeParse({ ...validSession, pausedAt: '2024-01-01T12:00:00.000Z' })
        .success
    ).toBe(true)
  })

  it('accepts empty viewedFiles', () => {
    expect(ReviewSessionSchema.safeParse({ ...validSession, viewedFiles: [] }).success).toBe(true)
  })

  it('rejects missing repoRoot', () => {
    const { repoRoot: _, ...rest } = validSession
    expect(ReviewSessionSchema.safeParse(rest).success).toBe(false)
  })
})

describe('InlineCommentSchema', () => {
  const validComment = {
    id: 1,
    author: 'alice',
    authorAvatarUrl: 'https://example.com/alice.png',
    body: 'LGTM',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    path: 'src/app.ts',
    line: 42,
    startLine: null,
    side: 'RIGHT' as const,
    diffHunk: '@@ -1,3 +1,4 @@',
    outdated: false,
    threadId: 'thread-1',
    isReply: false,
    parentId: null,
  }

  it('accepts valid inline comment', () => {
    expect(InlineCommentSchema.safeParse(validComment).success).toBe(true)
  })

  it('accepts both side values', () => {
    expect(InlineCommentSchema.safeParse({ ...validComment, side: 'LEFT' }).success).toBe(true)
    expect(InlineCommentSchema.safeParse({ ...validComment, side: 'RIGHT' }).success).toBe(true)
  })

  it('rejects invalid side', () => {
    expect(InlineCommentSchema.safeParse({ ...validComment, side: 'BOTH' }).success).toBe(false)
  })

  it('accepts reply with parentId', () => {
    expect(
      InlineCommentSchema.safeParse({ ...validComment, isReply: true, parentId: 1 }).success
    ).toBe(true)
  })
})

describe('ThreadSchema', () => {
  const validThread = {
    id: 'thread-1',
    path: 'src/app.ts',
    line: 42,
    startLine: null,
    side: 'RIGHT' as const,
    outdated: false,
    comments: [],
    collapsed: false,
  }

  it('accepts valid thread', () => {
    expect(ThreadSchema.safeParse(validThread).success).toBe(true)
  })

  it('accepts thread with startLine', () => {
    expect(ThreadSchema.safeParse({ ...validThread, startLine: 38 }).success).toBe(true)
  })

  it('rejects thread without required fields', () => {
    const { id: _, ...rest } = validThread
    expect(ThreadSchema.safeParse(rest).success).toBe(false)
  })
})
