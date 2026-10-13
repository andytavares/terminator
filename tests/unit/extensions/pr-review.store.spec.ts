import { describe, it, expect, beforeEach } from 'vitest'
import { usePrReviewStore } from '../../../extensions/git-integration/src/stores/pr-review.store'
import {
  PrReviewDetailSchema,
  ReviewSessionSchema,
  ThreadSchema,
  type PrReviewDetail,
  type RiskScore,
} from '../../../extensions/git-integration/src/schemas/pr-review.schema'
import { reviewQueuePr } from '../../../extensions/git-integration/tests/unit/support/review-queue-pr'

// persistSession checks `typeof window === 'undefined'` and returns early in Node
// so all state-mutation tests work cleanly without a DOM mock.

const makePR = reviewQueuePr

/** One chapter with one modified file: what the schema is handed for an active review. */
const DETAIL_INPUT = {
  number: 42,
  title: 'Fix: memory leak',
  body: 'Description here',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: '2024-01-01T00:00:00Z',
  headRefName: 'fix/memory-leak',
  baseRefName: 'main',
  headSHA: 'abc1234',
  ciStatus: 'passing',
  chapters: [
    {
      id: 'ch-1',
      name: 'Core Changes',
      files: [
        {
          path: 'src/app.ts',
          changeType: 'modified',
          additions: 10,
          deletions: 5,
          isBinary: false,
          tier: 1,
          whyHere: 'core logic',
          riskScore: {
            level: 'medium',
            composite: 50,
            metrics: {
              changeSize: 100,
              churn90d: null,
              blastRadius: null,
              testFilePresent: true,
              complexityDelta: null,
              patchCoverage: null,
            },
            dominantDriver: 'changeSize',
            topImporters: [],
            importerCount: 0,
          },
          estimatedMinutes: 5,
        },
      ],
      estimatedMinutes: 5,
      status: 'not-started',
    },
  ],
}

/** Parses afresh each time, so no case sees another's changes. */
const makeDetail = (): PrReviewDetail => PrReviewDetailSchema.parse(DETAIL_INPUT)

function resetStore() {
  usePrReviewStore.setState({
    prQueue: [],
    queueLoading: false,
    loadingMorePrs: false,
    queueError: null,
    hasMorePrs: false,
    nextPrCursor: undefined,
    activePr: null,
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: new Set(),
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    threads: {},
    rateLimitState: null,
  })
}

function useFreshPrReviewStore(): void {
  beforeEach(resetStore)
}

describe('usePrReviewStore — queue management', () => {
  useFreshPrReviewStore()

  it('setQueue replaces the PR queue', () => {
    usePrReviewStore.getState().setQueue([makePR(1), makePR(2)])
    expect(usePrReviewStore.getState().prQueue).toHaveLength(2)
  })

  it('appendQueue adds to existing queue', () => {
    usePrReviewStore.setState({ prQueue: [makePR(1)] })
    usePrReviewStore.getState().appendQueue([makePR(2), makePR(3)])
    expect(usePrReviewStore.getState().prQueue).toHaveLength(3)
  })

  it('setQueueLoading updates queueLoading', () => {
    usePrReviewStore.getState().setQueueLoading(true)
    expect(usePrReviewStore.getState().queueLoading).toBe(true)
    usePrReviewStore.getState().setQueueLoading(false)
    expect(usePrReviewStore.getState().queueLoading).toBe(false)
  })

  it('setLoadingMorePrs updates loadingMorePrs', () => {
    usePrReviewStore.getState().setLoadingMorePrs(true)
    expect(usePrReviewStore.getState().loadingMorePrs).toBe(true)
  })
})

describe('usePrReviewStore — queue errors and paging', () => {
  useFreshPrReviewStore()

  it('setQueueError sets error message', () => {
    usePrReviewStore.getState().setQueueError('API error')
    expect(usePrReviewStore.getState().queueError).toBe('API error')
  })

  it('setQueueError clears error with null', () => {
    usePrReviewStore.setState({ queueError: 'old error' })
    usePrReviewStore.getState().setQueueError(null)
    expect(usePrReviewStore.getState().queueError).toBeNull()
  })

  it('setHasMorePrs updates flag', () => {
    usePrReviewStore.getState().setHasMorePrs(true)
    expect(usePrReviewStore.getState().hasMorePrs).toBe(true)
  })

  it('setNextPrCursor stores cursor', () => {
    usePrReviewStore.getState().setNextPrCursor('cursor-abc')
    expect(usePrReviewStore.getState().nextPrCursor).toBe('cursor-abc')
  })
})

describe('usePrReviewStore — active review state', () => {
  useFreshPrReviewStore()

  it('setActivePr stores the PR detail', () => {
    const pr = makeDetail()
    usePrReviewStore.getState().setActivePr(pr)
    expect(usePrReviewStore.getState().activePr?.number).toBe(42)
  })

  it('setActivePr clears with null', () => {
    usePrReviewStore.setState({ activePr: makeDetail() })
    usePrReviewStore.getState().setActivePr(null)
    expect(usePrReviewStore.getState().activePr).toBeNull()
  })

  it('setCurrentChapter updates currentChapterId', () => {
    usePrReviewStore.getState().setCurrentChapter('ch-1')
    expect(usePrReviewStore.getState().currentChapterId).toBe('ch-1')
  })

  it('setCurrentFile updates currentFilePath', () => {
    usePrReviewStore.getState().setCurrentFile('src/app.ts')
    expect(usePrReviewStore.getState().currentFilePath).toBe('src/app.ts')
  })
})

describe('usePrReviewStore — viewed files tracking', () => {
  useFreshPrReviewStore()

  it('markFileViewed adds file to viewedFiles set', () => {
    usePrReviewStore
      .getState()
      .markFileViewed({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc1234' }, 'src/app.ts')
    expect(usePrReviewStore.getState().viewedFiles.has('src/app.ts')).toBe(true)
  })

  it('markFileViewed is idempotent', () => {
    usePrReviewStore
      .getState()
      .markFileViewed({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc1234' }, 'src/app.ts')
    usePrReviewStore
      .getState()
      .markFileViewed({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc1234' }, 'src/app.ts')
    expect(usePrReviewStore.getState().viewedFiles.size).toBe(1)
  })

  it('unmarkFileViewed removes file from viewedFiles', () => {
    usePrReviewStore.setState({ viewedFiles: new Set(['src/app.ts']) })
    usePrReviewStore
      .getState()
      .unmarkFileViewed({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc1234' }, 'src/app.ts')
    expect(usePrReviewStore.getState().viewedFiles.has('src/app.ts')).toBe(false)
  })
})

describe('usePrReviewStore — file reordering', () => {
  useFreshPrReviewStore()

  it('reorderFiles updates fileOrderOverrides', () => {
    usePrReviewStore
      .getState()
      .reorderFiles({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc' }, 'ch-1', [
        'src/b.ts',
        'src/a.ts',
      ])
    expect(usePrReviewStore.getState().fileOrderOverrides['ch-1']).toEqual(['src/b.ts', 'src/a.ts'])
  })

  it('reorderFiles preserves overrides for other chapters', () => {
    usePrReviewStore.setState({ fileOrderOverrides: { 'ch-2': ['x.ts'] } })
    usePrReviewStore
      .getState()
      .reorderFiles({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc' }, 'ch-1', ['src/b.ts'])
    expect(usePrReviewStore.getState().fileOrderOverrides['ch-2']).toEqual(['x.ts'])
  })
})

describe('usePrReviewStore — scroll and pause state', () => {
  useFreshPrReviewStore()

  it('setScrollPosition stores position', () => {
    usePrReviewStore.getState().setScrollPosition(250)
    expect(usePrReviewStore.getState().scrollPosition).toBe(250)
  })

  it('setScrollPosition clears with null', () => {
    usePrReviewStore.setState({ scrollPosition: 100 })
    usePrReviewStore.getState().setScrollPosition(null)
    expect(usePrReviewStore.getState().scrollPosition).toBeNull()
  })

  it('setPaused stores timestamp', () => {
    usePrReviewStore
      .getState()
      .setPaused({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc' }, '2024-01-01T12:00:00Z')
    expect(usePrReviewStore.getState().pausedAt).toBe('2024-01-01T12:00:00Z')
  })

  it('setPaused clears with null', () => {
    usePrReviewStore.setState({ pausedAt: '2024-01-01T12:00:00Z' })
    usePrReviewStore.getState().setPaused({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc' }, null)
    expect(usePrReviewStore.getState().pausedAt).toBeNull()
  })
})

describe('usePrReviewStore — threads', () => {
  useFreshPrReviewStore()

  it('setThreads stores thread list by path', () => {
    const threads = [
      ThreadSchema.parse({
        id: 't-1',
        path: 'src/app.ts',
        line: 42,
        startLine: null,
        side: 'RIGHT',
        outdated: false,
        comments: [],
        collapsed: false,
      }),
    ]
    usePrReviewStore.getState().setThreads('src/app.ts', threads)
    expect(usePrReviewStore.getState().threads['src/app.ts']).toEqual(threads)
  })
})

describe('usePrReviewStore — replacing threads', () => {
  useFreshPrReviewStore()

  it('setThreads overwrites existing threads for the same path', () => {
    usePrReviewStore.setState({ threads: { 'src/app.ts': [] } })
    const threads = [
      ThreadSchema.parse({
        id: 't-1',
        path: 'src/app.ts',
        line: 10,
        startLine: null,
        side: 'RIGHT',
        outdated: false,
        comments: [],
        collapsed: false,
      }),
    ]
    usePrReviewStore.getState().setThreads('src/app.ts', threads)
    expect(usePrReviewStore.getState().threads['src/app.ts']).toHaveLength(1)
  })
})

describe('usePrReviewStore — updateFileRiskScore', () => {
  useFreshPrReviewStore()

  it('updates risk score for file in specified chapter', () => {
    usePrReviewStore.setState({ activePr: makeDetail() })
    const newRisk: RiskScore = {
      level: 'high',
      composite: 90,
      metrics: {
        changeSize: 200,
        churn90d: 10,
        blastRadius: 5,
        testFilePresent: false,
        complexityDelta: 20,
        patchCoverage: 60,
      },
      dominantDriver: 'changeSize',
      topImporters: [],
      importerCount: 0,
    }
    usePrReviewStore.getState().updateFileRiskScore('ch-1', 'src/app.ts', newRisk)
    const file = usePrReviewStore.getState().activePr?.chapters[0].files[0]
    expect(file?.riskScore.level).toBe('high')
    expect(file?.riskScore.composite).toBe(90)
  })

  it('is a no-op when activePr is null', () => {
    const risk = makeDetail().chapters[0].files[0].riskScore
    usePrReviewStore.getState().updateFileRiskScore('ch-1', 'src/app.ts', risk)
    expect(usePrReviewStore.getState().activePr).toBeNull()
  })
})

describe('usePrReviewStore — updateQueuePrRisk', () => {
  useFreshPrReviewStore()

  it('updates risk level and signal dots for matching PR', () => {
    usePrReviewStore.setState({ prQueue: [makePR(42)] })
    const dots = {
      tests: 'fail' as const,
      coverage: 'warn' as const,
      ci: 'pass' as const,
      lint: 'pass' as const,
      churn: 'pass' as const,
      blast: 'pass' as const,
    }
    usePrReviewStore.getState().updateQueuePrRisk(42, 'high', dots)
    expect(usePrReviewStore.getState().prQueue[0].riskLevel).toBe('high')
    expect(usePrReviewStore.getState().prQueue[0].signalDots.tests).toBe('fail')
  })

  it('does not affect other PRs in the queue', () => {
    usePrReviewStore.setState({ prQueue: [makePR(1), makePR(2)] })
    const dots = {
      tests: 'fail' as const,
      coverage: 'fail' as const,
      ci: 'fail' as const,
      lint: 'fail' as const,
      churn: 'fail' as const,
      blast: 'fail' as const,
    }
    usePrReviewStore.getState().updateQueuePrRisk(1, 'high', dots)
    expect(usePrReviewStore.getState().prQueue[1].riskLevel).toBe('low')
  })
})

describe('usePrReviewStore — setRateLimitState', () => {
  useFreshPrReviewStore()

  it('stores rate limit state', () => {
    const state = { resetAt: Date.now() + 60000 }
    usePrReviewStore.getState().setRateLimitState(state)
    expect(usePrReviewStore.getState().rateLimitState).toEqual(state)
  })

  it('clears rate limit state with null', () => {
    usePrReviewStore.setState({ rateLimitState: { resetAt: 9999 } })
    usePrReviewStore.getState().setRateLimitState(null)
    expect(usePrReviewStore.getState().rateLimitState).toBeNull()
  })
})

describe('usePrReviewStore — initSession', () => {
  useFreshPrReviewStore()

  it('restores session state from ReviewSession object', () => {
    const session = ReviewSessionSchema.parse({
      repoRoot: '/repo',
      prNumber: 42,
      headSHA: 'abc',
      currentChapterId: 'ch-2',
      currentFilePath: 'src/util.ts',
      viewedFiles: ['src/app.ts', 'src/util.ts'],
      fileOrderOverrides: { 'ch-1': ['src/b.ts', 'src/a.ts'] },
      scrollPosition: 500,
      pausedAt: null,
      lastAccessedAt: '2024-01-01T00:00:00Z',
    })
    usePrReviewStore.getState().initSession(session)
    const state = usePrReviewStore.getState()
    expect(state.currentChapterId).toBe('ch-2')
    expect(state.currentFilePath).toBe('src/util.ts')
    expect(state.viewedFiles.has('src/app.ts')).toBe(true)
    expect(state.viewedFiles.has('src/util.ts')).toBe(true)
    expect(state.fileOrderOverrides['ch-1']).toEqual(['src/b.ts', 'src/a.ts'])
    expect(state.scrollPosition).toBe(500)
  })
})

describe('usePrReviewStore — reset', () => {
  useFreshPrReviewStore()

  it('clears active PR, chapters, viewed files, and threads', () => {
    usePrReviewStore.setState({
      activePr: makeDetail(),
      currentChapterId: 'ch-1',
      currentFilePath: 'src/app.ts',
      viewedFiles: new Set(['src/app.ts']),
      fileOrderOverrides: { 'ch-1': ['a.ts'] },
      scrollPosition: 200,
      threads: { 'src/app.ts': [] },
    })
    usePrReviewStore.getState().reset()
    const state = usePrReviewStore.getState()
    expect(state.activePr).toBeNull()
    expect(state.currentChapterId).toBeNull()
    expect(state.currentFilePath).toBeNull()
    expect(state.viewedFiles.size).toBe(0)
    expect(Object.keys(state.fileOrderOverrides)).toHaveLength(0)
    expect(state.scrollPosition).toBeNull()
    expect(Object.keys(state.threads)).toHaveLength(0)
  })

  it('does not clear prQueue', () => {
    usePrReviewStore.setState({ prQueue: [makePR(1)] })
    usePrReviewStore.getState().reset()
    expect(usePrReviewStore.getState().prQueue).toHaveLength(1)
  })
})

describe('usePrReviewStore — patchFileComplexity', () => {
  useFreshPrReviewStore()

  it('updates complexity delta and adjusts composite score', () => {
    usePrReviewStore.setState({ activePr: makeDetail() })
    usePrReviewStore.getState().patchFileComplexity('ch-1', 'src/app.ts', 10)
    const file = usePrReviewStore.getState().activePr?.chapters[0].files[0]
    expect(file?.riskScore.metrics.complexityDelta).toBe(10)
    // 50, plus 10/15 of complexity's 8 points, rounded.
    expect(file?.riskScore).toMatchObject({ composite: 55, level: 'medium' })
  })

  it('is a no-op when activePr is null', () => {
    usePrReviewStore.getState().patchFileComplexity('ch-1', 'src/app.ts', 5)
    expect(usePrReviewStore.getState().activePr).toBeNull()
  })

  it('does not modify files in other chapters', () => {
    const detail = makeDetail()
    detail.chapters.push({
      id: 'ch-2',
      name: 'Other',
      files: [{ ...detail.chapters[0].files[0], path: 'src/other.ts' }],
      estimatedMinutes: 3,
      status: 'not-started',
    })
    usePrReviewStore.setState({ activePr: detail })
    usePrReviewStore.getState().patchFileComplexity('ch-1', 'src/app.ts', 10)
    const otherChapter = usePrReviewStore.getState().activePr?.chapters[1]
    expect(otherChapter?.files[0].riskScore.metrics.complexityDelta).toBeNull()
  })
})
