import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { renderHook, act } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { reviewQueuePr } from './support/review-queue-pr'
import { PrReviewDetailSchema, type PrChangedFile } from '../../src/schemas/pr-review.schema'
import {
  useLoadPrQueue,
  useLoadPrDetail,
  useFetchFileMetrics,
  useLoadInlineComments,
  useLoadIssueComments,
} from '../../src/hooks/usePrReview'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

const mockListOpenPrsAPI = vi.fn()
const mockPrReviewDetailAPI = vi.fn()
const mockFileMetricsAPI = vi.fn()
const mockFilesMetricsAPI = vi.fn()
const mockPrInlineCommentsAPI = vi.fn()
const mockSessionsForRepoAPI = vi.fn().mockResolvedValue({ sessions: [] })
const mockActiveReviewsForRepoAPI = vi.fn().mockResolvedValue({ error: 'NOT_FOUND' })
const mockPruneActiveReviewsAPI = vi.fn().mockResolvedValue({ openNumbers: [] })
const mockCurrentUserAPI = vi.fn().mockResolvedValue({ login: 'testuser' })

const mockPrIssueCommentsAPI = vi.fn()

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    currentUser: (...args: unknown[]) => mockCurrentUserAPI(...args),
    listOpenPrs: (...args: unknown[]) => mockListOpenPrsAPI(...args),
    prReviewDetail: (...args: unknown[]) => mockPrReviewDetailAPI(...args),
    // Adapts the per-file fixtures below to the batched call the hook now makes.
    filesMetrics: async (root: string, paths: string[]) => {
      mockFilesMetricsAPI(root, paths)
      const metrics: Record<string, unknown> = {}
      for (const path of paths) {
        const one = await mockFileMetricsAPI(root, path)
        if (one && !('error' in one)) metrics[path] = one
      }
      return { metrics }
    },
    prInlineComments: (...args: unknown[]) => mockPrInlineCommentsAPI(...args),
    prIssueComments: (...args: unknown[]) => mockPrIssueCommentsAPI(...args),
    sessionsForRepo: (...args: unknown[]) => mockSessionsForRepoAPI(...args),
    activeReviewsForRepo: (...args: unknown[]) => mockActiveReviewsForRepoAPI(...args),
    pruneActiveReviews: (...args: unknown[]) => mockPruneActiveReviewsAPI(...args),
  },
}))

vi.mock('../../src/github/pr-review-service', async (importActual) => {
  const actual = await importActual<typeof import('../../src/github/pr-review-service')>()
  return {
    // Keep the real queueRiskLevel + thresholds so the size-floor logic runs for real;
    // only computeRiskScore (the per-file scorer) is stubbed to a fixed low result.
    ...actual,
    computeRiskScore: vi.fn().mockReturnValue({
      level: 'low',
      composite: 10,
      dominantDriver: 'changeSize',
      topImporters: [],
      importerCount: 0,
      metrics: {
        changeSize: 5,
        churn90d: null,
        blastRadius: null,
        testFilePresent: null,
        complexityDelta: null,
        patchCoverage: null,
      },
    }),
  }
})

vi.mock('../../src/github/pr-review-service-renderer', () => ({
  buildThreads: vi
    .fn()
    .mockReturnValue([
      { id: 'thread-1', path: 'src/foo.ts', line: 10, startLine: null, comments: [] },
    ]),
}))

const mockSetQueue = vi.fn()
const mockAppendQueue = vi.fn()
const mockSetQueueLoading = vi.fn()
const mockSetLoadingMorePrs = vi.fn()
const mockSetQueueError = vi.fn()
const mockSetRateLimitState = vi.fn()
const mockSetHasMorePrs = vi.fn()
const mockSetNextPrCursor = vi.fn()
const mockSetActivePr = vi.fn()
const mockSetThreads = vi.fn()
const mockSetIssueComments = vi.fn()
const mockUpdateFileRiskScores = vi.fn()
const mockUpdateQueuePrRisk = vi.fn()
const mockSetCurrentUserLogin = vi.fn()

// Aliases so test assertions work without changes
const mockListOpenPrs = mockListOpenPrsAPI
const mockPrReviewDetail = mockPrReviewDetailAPI
const mockFileMetrics = mockFileMetricsAPI
const mockPrInlineComments = mockPrInlineCommentsAPI

// Parsed as the review channel's answer is, so the schema's defaults are filled in.
const validActivePr = PrReviewDetailSchema.parse({
  number: 42,
  title: 'Test PR',
  body: '',
  author: 'alice',
  authorAvatarUrl: 'https://example.com/avatar.png',
  openedAt: '2025-01-01T00:00:00Z',
  headRefName: 'feature',
  baseRefName: 'main',
  headSHA: 'abc123',
  ciStatus: 'passing' as const,
  lintStatus: 'pass' as const,
  coverageStatus: 'pass' as const,
  chapters: [],
})

const NO_METRICS = {
  changeSize: null,
  churn90d: null,
  blastRadius: null,
  testFilePresent: null,
  complexityDelta: null,
  patchCoverage: null,
}

type ChangedFile = ReturnType<typeof file>

/** A modified file at `path` in `tier`, with a low risk score and no metrics yet. */
function file(path: string, tier: 1 | 2 | 3 = 1): PrChangedFile {
  return {
    path,
    changeType: 'modified' as const,
    additions: 4,
    deletions: 1,
    isBinary: false,
    tier,
    whyHere: 'changed',
    estimatedMinutes: 1,
    riskScore: {
      level: 'low' as const,
      composite: null,
      dominantDriver: '',
      topImporters: [],
      importerCount: 0,
      metrics: { ...NO_METRICS },
    },
  }
}

/** A chapter holding `files`. */
function chapterWithFiles(id: string, files: ChangedFile[]) {
  return { id, name: id, estimatedMinutes: 1, status: 'not-started' as const, files }
}

/** The active PR with one chapter of `files`. */
function prWithFiles(files: ChangedFile[], overrides: Record<string, unknown> = {}) {
  return { ...validActivePr, ...overrides, chapters: [chapterWithFiles('ch-1', files)] }
}

/** A PR whose one file, src/foo.ts, has no score yet, with CI in `ciStatus`. */
function makePrWithFile(ciStatus: 'passing' | 'failing' | 'pending' | 'none' = 'passing') {
  return prWithFiles([file('src/foo.ts')], { ciStatus, coverageStatus: 'unknown' as const })
}

/** Serves `activePr` from the store, with the setters the hooks under test call. */
function withActivePr(activePr: unknown) {
  vi.mocked(usePrReviewStore).mockReturnValue({
    ...vi.mocked(usePrReviewStore)(),
    activePr,
    setThreads: mockSetThreads,
    setIssueComments: mockSetIssueComments,
    updateFileRiskScores: mockUpdateFileRiskScores,
    updateQueuePrRisk: mockUpdateQueuePrRisk,
  })
}

/** Every file's metrics: low churn and blast radius, a test file, and `extra`. */
function metricsAnswer(extra: Record<string, unknown> = {}) {
  mockFileMetrics.mockResolvedValue({
    churn90d: 5,
    blastRadius: 2,
    topImporters: [],
    importerCount: 0,
    testFilePresent: true,
    ...extra,
  })
}

/** Calls a hook's loader once, inside act. */
async function load<A extends unknown[]>(loader: (...args: A) => Promise<unknown>, ...args: A) {
  await act(async () => {
    await loader(...args)
  })
}

/** Loads the queue of /repo once. */
async function loadQueueVia(options?: Parameters<ReturnType<typeof useLoadPrQueue>>[0]) {
  const { result } = renderHook(() => useLoadPrQueue('/repo'))
  await load(result.current, options)
}

/** The queue the last load set. */
const queuedPrs = (): Array<{ number: number; sessionStatus?: string }> =>
  mockSetQueue.mock.calls[0]?.[0] ?? []

/** A review row stored as active, not on the loaded page. */
function orphanPr(number: number, overrides: Record<string, unknown> = {}) {
  return { ...reviewQueuePr(number), title: 'Orphan PR', ...overrides }
}

/** The queue loads with only `orphan` stored as active, and prune answers `prune`. */
async function loadWithOrphan(orphan: unknown, prune: () => unknown) {
  mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false })
  mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
  mockActiveReviewsForRepoAPI.mockResolvedValue({ prs: [orphan] })
  mockPruneActiveReviewsAPI.mockImplementation(async () => prune())
  await loadQueueVia()
}

/** A stored session of PR 42 that viewed src/foo.ts, paused at `pausedAt`. */
function storedSession(pausedAt: string | null) {
  return {
    repoRoot: '/repo',
    prNumber: 42,
    headSHA: 'abc123',
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: ['src/foo.ts'],
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt,
    lastAccessedAt: '2026-01-01T00:00:00Z',
  }
}

/** PR 42 as gh lists it. */
const ghPr42 = {
  number: 42,
  title: 'Test',
  author: { login: 'alice', avatarUrl: '' },
  createdAt: '2025-01-01T00:00:00Z',
  headRefName: 'feat/test',
  baseRefName: 'main',
  isDraft: false,
  statusCheckRollup: [],
  files: [],
  additions: 0,
  deletions: 0,
}

/** A promise and the function that resolves it, for answers the test releases in order. */
function deferred() {
  let resolve!: (v: unknown) => void
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** A review comment `id`, the first of thread `threadId`, on line 10 of `path`. */
function reviewComment(id: number, threadId: string, path: string) {
  return {
    id,
    author: 'alice',
    authorAvatarUrl: '',
    body: 'hi',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    path,
    line: 10,
    startLine: null,
    side: 'RIGHT' as const,
    diffHunk: '',
    outdated: false,
    threadId,
    isReply: false,
    parentId: null,
  }
}

/** The unresolved thread `comment` starts. */
function threadOf(comment: ReturnType<typeof reviewComment>) {
  const { threadId: id, path, line, side } = comment
  const place = { id, path, line, startLine: null, side, outdated: false }
  return { ...place, comments: [comment], collapsed: false, resolved: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  // The hooks read the live PR through getState(); serve whatever the test configured.
  Object.assign(usePrReviewStore, { getState: () => vi.mocked(usePrReviewStore)() })
  Object.assign(globalThis, {
    electronAPI: {
      github: {
        listOpenPrs: mockListOpenPrs,
        prReviewDetail: mockPrReviewDetail,
        fileMetrics: mockFileMetrics,
        prInlineComments: mockPrInlineComments,
      },
    },
  })
  vi.mocked(usePrReviewStore).mockReturnValue({
    setQueue: mockSetQueue,
    appendQueue: mockAppendQueue,
    setQueueLoading: mockSetQueueLoading,
    setLoadingMorePrs: mockSetLoadingMorePrs,
    setQueueError: mockSetQueueError,
    setRateLimitState: mockSetRateLimitState,
    setHasMorePrs: mockSetHasMorePrs,
    setNextPrCursor: mockSetNextPrCursor,
    setActivePr: mockSetActivePr,
    setThreads: mockSetThreads,
    updateFileRiskScores: mockUpdateFileRiskScores,
    updateQueuePrRisk: mockUpdateQueuePrRisk,
    setCurrentUserLogin: mockSetCurrentUserLogin,
    activePr: null,
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

describe('useLoadPrQueue', () => {
  it('returns a function', () => {
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    expect(typeof result.current).toBe('function')
  })

  it('does nothing when repoRoot is null', async () => {
    const { result } = renderHook(() => useLoadPrQueue(null))
    await load(result.current)
    expect(mockListOpenPrs).not.toHaveBeenCalled()
  })

  it('calls listOpenPrs and sets queue on success', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(mockListOpenPrs).toHaveBeenCalledWith('/repo', expect.any(Object))
    expect(mockSetQueue).toHaveBeenCalled()
  })
})

describe('useLoadPrQueue — sets queue error when listOpenPrs returns error', () => {
  it('sets queue error when listOpenPrs returns error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'NETWORK_ERROR' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(mockSetQueueError).toHaveBeenCalledWith('NETWORK_ERROR')
  })

  it('sets rate limit state when RATE_LIMITED error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'RATE_LIMITED', resetAt: 99999 })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(mockSetRateLimitState).toHaveBeenCalledWith({ resetAt: 99999 })
  })

  it('sets queue error on exception', async () => {
    mockListOpenPrs.mockRejectedValue(new Error('crash'))
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(mockSetQueueError).toHaveBeenCalledWith(expect.stringContaining('crash'))
  })
})

describe('useLoadPrQueue — appends to queue when append option is true', () => {
  it('appends to queue when append option is true', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current, { append: true })
    expect(mockAppendQueue).toHaveBeenCalled()
    expect(mockSetQueue).not.toHaveBeenCalled()
  })
})

describe('useLoadPrQueue — excludes orphan PRs when pruneActiveReviews reports them closed/merged', () => {
  it('excludes orphan PRs when pruneActiveReviews reports them closed/merged', async () => {
    // pruneActiveReviews returns empty openNumbers → PR 99 is closed/merged
    await loadWithOrphan(orphanPr(99, { viewedFileCount: 1 }), () => ({ openNumbers: [] }))
    expect(queuedPrs().find((p) => p.number === 99)).toBeUndefined()
  })
})

describe('useLoadPrQueue — includes orphan PRs when pruneActiveReviews confirms they are still open', () => {
  it('includes orphan PRs when pruneActiveReviews confirms they are still open', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: true, nextCursor: 'cursor-1' })
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
    mockActiveReviewsForRepoAPI.mockResolvedValue({ prs: [orphanPr(99, { viewedFileCount: 1 })] })
    // pruneActiveReviews returns 99 → PR is still open (just on a later page)
    mockPruneActiveReviewsAPI.mockResolvedValue({ openNumbers: [99] })
    await loadQueueVia()
    expect(queuedPrs().find((p) => p.number === 99)).toBeDefined()
  })
})

describe('useLoadPrQueue — keeps all orphans when pruneActiveReviews returns an error object', () => {
  it('keeps all orphans when pruneActiveReviews returns an error object', async () => {
    // pruneActiveReviews returns an error — orphan should still appear
    await loadWithOrphan(orphanPr(55, { title: 'Orphan' }), () => ({ error: 'NETWORK_ERROR' }))
    expect(queuedPrs().find((p) => p.number === 55)).toBeDefined()
  })
})

describe('useLoadPrQueue — keeps all orphans when pruneActiveReviews throws', () => {
  it('keeps all orphans when pruneActiveReviews throws', async () => {
    // pruneActiveReviews throws — orphan should still appear
    await loadWithOrphan(orphanPr(66, { sessionStatus: 'paused' }), () => {
      throw new Error('bridge disconnected')
    })
    expect(queuedPrs().find((p) => p.number === 66)).toBeDefined()
  })
})

describe('useLoadPrQueue — sets hasMorePrs and nextCursor from response', () => {
  it('sets hasMorePrs and nextCursor from response', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: true, nextCursor: 'cursor-abc' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(mockSetHasMorePrs).toHaveBeenCalledWith(true)
    expect(mockSetNextPrCursor).toHaveBeenCalledWith('cursor-abc')
  })

  it('uses setLoadingMorePrs when appending', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current, { append: true })
    expect(mockSetLoadingMorePrs).toHaveBeenCalledWith(true)
    expect(mockSetLoadingMorePrs).toHaveBeenCalledWith(false)
  })
})

describe('useLoadPrQueue — TAV-7: discards a stale response that resolves after a newer request', () => {
  it('TAV-7: discards a stale response that resolves after a newer request', async () => {
    // Simulates pasting "049": an earlier query's slower response (e.g. a
    // broader text search) resolves *after* a later query's faster response
    // (e.g. the exact PR-number lookup). The stale response must not clobber
    // the newer, correct result.
    const stale = deferred()
    const fresh = deferred()
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
    mockActiveReviewsForRepoAPI.mockResolvedValue({ error: 'NOT_FOUND' })
    mockListOpenPrs.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    const staleCall = result.current({ search: '04' })
    const freshCall = result.current({ search: '049' })

    // Fresh (later-issued) request resolves first, then the stale one.
    fresh.resolve({ prs: [{ ...reviewQueuePr(49), sessionStatus: 'not-started' }], hasMore: false })
    await load(() => freshCall)
    stale.resolve({ prs: [{ ...reviewQueuePr(50), sessionStatus: 'not-started' }], hasMore: false })
    await load(() => staleCall)

    // setQueue must have been called exactly once, with the fresh result —
    // the stale, later-arriving response must be discarded.
    expect(mockSetQueue).toHaveBeenCalledTimes(1)
    expect(mockSetQueue).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ number: 49 })])
    )
  })
})

describe('useLoadPrQueue — TAV-7: discards a stale currentUser response for a superseded request', () => {
  it('TAV-7: discards a stale currentUser response for a superseded request', async () => {
    let resolveStaleUser!: (v: unknown) => void
    mockCurrentUserAPI
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleUser = resolve
          })
      )
      .mockResolvedValueOnce({ login: 'fresh-user' })
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })

    const { result } = renderHook(() => useLoadPrQueue('/repo'))

    const staleCall = result.current()
    const freshCall = result.current()
    await act(async () => {
      await freshCall
    })
    resolveStaleUser({ login: 'stale-user' })
    await act(async () => {
      await staleCall
    })

    // The superseded (stale) request's currentUser response must not overwrite
    // the newer request's login.
    expect(mockSetCurrentUserLogin).not.toHaveBeenCalledWith('stale-user')
    expect(mockSetCurrentUserLogin).toHaveBeenCalledWith('fresh-user')
  })
})

describe('useLoadPrDetail', () => {
  it('returns a function', () => {
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    expect(typeof result.current).toBe('function')
  })

  it('does nothing when repoRoot is null', async () => {
    const { result } = renderHook(() => useLoadPrDetail(null))
    await load(result.current, 1, vi.fn())
    expect(mockPrReviewDetail).not.toHaveBeenCalled()
  })

  it('calls prReviewDetail and invokes onSuccess callback with parsed data', async () => {
    mockPrReviewDetail.mockResolvedValue({ pr: validActivePr })
    const onSuccess = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await load(result.current, 42, onSuccess)
    expect(mockPrReviewDetail).toHaveBeenCalledWith('/repo', 42)
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ number: 42 }))
  })
})

describe('useLoadPrDetail — does not call onSuccess when result has error', () => {
  it('does not call onSuccess when result has error', async () => {
    mockPrReviewDetail.mockResolvedValue({ error: 'NETWORK_ERROR' })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await load(result.current, 1, onSuccess)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('handles RATE_LIMITED error', async () => {
    mockPrReviewDetail.mockResolvedValue({ error: 'RATE_LIMITED', resetAt: 12345 })
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await load(result.current, 1, vi.fn())
    expect(mockSetRateLimitState).toHaveBeenCalledWith({ resetAt: 12345 })
  })
})

describe('useLoadPrDetail — does not crash on exception', () => {
  it('does not crash on exception', async () => {
    mockPrReviewDetail.mockRejectedValue(new Error('network fail'))
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    const onSuccess = vi.fn()
    await load(result.current, 1, onSuccess)
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('useLoadInlineComments', () => {
  it('returns a function', () => {
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    expect(typeof result.current).toBe('function')
  })

  it('does nothing when repoRoot is null', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
    })
    const { result } = renderHook(() => useLoadInlineComments(null))
    await load(result.current)
    expect(mockPrInlineComments).not.toHaveBeenCalled()
  })

  it('does nothing when activePr is null', async () => {
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)
    expect(mockPrInlineComments).not.toHaveBeenCalled()
  })
})

describe('useLoadInlineComments — calls prInlineComments and sets threads when activePr is set', () => {
  it('calls prInlineComments and sets threads when activePr is set', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setThreads: mockSetThreads,
    })
    mockPrInlineComments.mockResolvedValue({ comments: [] })
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)
    expect(mockPrInlineComments).toHaveBeenCalledWith('/repo', 42)
    expect(mockSetThreads).toHaveBeenCalled()
  })
})

describe('useLoadInlineComments — does nothing when result has error', () => {
  it('does nothing when result has error', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setThreads: mockSetThreads,
    })
    mockPrInlineComments.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)
    expect(mockSetThreads).not.toHaveBeenCalled()
  })
})

describe('useLoadInlineComments — marks a thread resolved when its first comment id is in resolvedCommentIds', () => {
  it('marks a thread resolved when its first comment id is in resolvedCommentIds', async () => {
    withActivePr(validActivePr)
    const { buildThreads } = await import('../../src/github/pr-review-service-renderer')
    const comment = reviewComment(1, 't1', 'src/foo.ts')
    const otherComment = reviewComment(2, 't2', 'src/bar.ts')
    vi.mocked(buildThreads).mockReturnValueOnce([threadOf(comment), threadOf(otherComment)])
    mockPrInlineComments.mockResolvedValue({
      comments: [comment, otherComment],
      resolvedCommentIds: [1],
    })
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)
    const calls = mockSetThreads.mock.calls
    expect(calls.find((c) => c[0] === 'src/foo.ts')?.[1][0].resolved).toBe(true)
    expect(calls.find((c) => c[0] === 'src/bar.ts')?.[1][0].resolved).toBe(false)
  })
})

describe('useFetchFileMetrics', () => {
  it('returns a function', () => {
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    expect(typeof result.current).toBe('function')
  })

  it('does nothing when repoRoot is null', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
    })
    const { result } = renderHook(() => useFetchFileMetrics(null))
    await load(result.current)
    expect(mockFileMetrics).not.toHaveBeenCalled()
  })

  it('does nothing when no activePr and no prDetail arg', async () => {
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(mockFileMetrics).not.toHaveBeenCalled()
  })
})

describe('useFetchFileMetrics — fetches file metrics and updates risk scores for chapters with files', () => {
  it('fetches file metrics and updates risk scores for chapters with files', async () => {
    withActivePr(prWithFiles([file('src/foo.ts')]))
    metricsAnswer()
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(mockFileMetrics).toHaveBeenCalledWith('/repo', 'src/foo.ts')
    expect(mockUpdateFileRiskScores).toHaveBeenCalled()
    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
  })
})

describe('useFetchFileMetrics — keeps a large but mechanically-simple PR at high risk via the size floor', () => {
  it('keeps a large but mechanically-simple PR at high risk via the size floor', async () => {
    const big = { ...file('src/big.ts'), additions: 500, deletions: 0 }
    big.riskScore.metrics.changeSize = 500
    withActivePr(prWithFiles([big]))
    // Low per-file signals → per-file risk is 'low', but 500 lines changed
    // must still resolve to 'high' because of the size floor.
    metricsAnswer({ churn90d: 1, blastRadius: 1 })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(mockUpdateQueuePrRisk).toHaveBeenCalledWith(42, 'high', expect.anything())
  })
})

describe('useFetchFileMetrics — does nothing when all files are tier-3 (lock files excluded from risk scoring)', () => {
  it('does nothing when all files are tier-3 (lock files excluded from risk scoring)', async () => {
    withActivePr(
      prWithFiles([{ ...file('package-lock.json', 3), additions: 1000, deletions: 1000 }])
    )
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    // Tier 3 files are excluded, so no metrics calls
    expect(mockFileMetrics).not.toHaveBeenCalled()
  })
})

describe('useFetchFileMetrics — handles fileMetrics returning an error object (null value)', () => {
  it('handles fileMetrics returning an error object (null value)', async () => {
    withActivePr(prWithFiles([file('src/foo.ts')]))
    // Return an error — should produce null (filtered out)
    mockFileMetrics.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    // collected.length === 0 so no updateFileRiskScore or updateQueuePrRisk
    expect(mockUpdateFileRiskScores).not.toHaveBeenCalled()
    expect(mockUpdateQueuePrRisk).not.toHaveBeenCalled()
  })
})

describe('useLoadPrQueue — NOT_AUTHENTICATED branch', () => {
  it('sets queue error with auth message when NOT_AUTHENTICATED error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'NOT_AUTHENTICATED' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(mockSetQueueError).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'))
  })

  it('uses fallback resetAt when RATE_LIMITED has no resetAt', async () => {
    // resetAt is undefined — falls back to Date.now() + 60_000
    mockListOpenPrs.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(mockSetRateLimitState).toHaveBeenCalledWith({
      resetAt: expect.any(Number),
    })
  })
})

describe('useLoadPrQueue — NOT_AUTHENTICATED branch — passes cursor and search options to listOpenPrs', () => {
  it('passes cursor and search options to listOpenPrs', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current, { cursor: 'cursor-123', search: 'fix bug' })
    expect(mockListOpenPrs).toHaveBeenCalledWith('/repo', {
      cursor: 'cursor-123',
      search: 'fix bug',
    })
  })
})

describe('useLoadPrQueue — NOT_AUTHENTICATED branch — mergeSessionStatuses: session with pausedAt=null is in-progress', () => {
  it('mergeSessionStatuses: session with pausedAt=null is in-progress', async () => {
    // in-progress (not paused)
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [storedSession(null)] })
    mockListOpenPrs.mockResolvedValue({ prs: [ghPr42], hasMore: false })
    await loadQueueVia()
    // Should call sessionsForRepo to merge statuses
    expect(mockSessionsForRepoAPI).toHaveBeenCalledWith('/repo')
    // Queue should be set (with merged session status)
    expect(mockSetQueue).toHaveBeenCalled()
  })
})

describe('useLoadPrQueue — NOT_AUTHENTICATED branch — mergeSessionStatuses: session with pausedAt set marks PR as paused', () => {
  it('mergeSessionStatuses: session with pausedAt set marks PR as paused', async () => {
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [storedSession('2026-01-01T00:00:00Z')] })
    const pr42 = { ...reviewQueuePr(42), title: 'Test', sessionStatus: 'not-started' }
    mockListOpenPrs.mockResolvedValue({ prs: [pr42], hasMore: false })
    await loadQueueVia()
    expect(queuedPrs().find((p) => p.number === 42)?.sessionStatus).toBe('paused')
  })
})

describe('useLoadPrQueue — NOT_AUTHENTICATED branch — mergeSessionStatuses: falls back to original prs on error', () => {
  it('mergeSessionStatuses: falls back to original prs on error', async () => {
    mockSessionsForRepoAPI.mockRejectedValue(new Error('IPC error'))

    const prData = {
      number: 42,
      title: 'Test',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      statusCheckRollup: [],
      files: [],
      additions: 0,
      deletions: 0,
    }

    mockListOpenPrs.mockResolvedValue({ prs: [prData], hasMore: false })

    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)

    // Should still set queue (with original prs, fallback on error)
    expect(mockSetQueue).toHaveBeenCalled()
  })
})

describe('useLoadPrDetail — additional branches', () => {
  it('handles RATE_LIMITED with no explicit resetAt (uses fallback)', async () => {
    mockPrReviewDetail.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await load(result.current, 1, vi.fn())
    expect(mockSetRateLimitState).toHaveBeenCalledWith({
      resetAt: expect.any(Number),
    })
  })

  it('does not call onSuccess when parsed schema fails', async () => {
    // Return a pr object that fails schema validation
    mockPrReviewDetail.mockResolvedValue({ pr: { invalid: true } })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await load(result.current, 1, onSuccess)
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268)', () => {
  it('coverageDot=pass when avgCoverage >= 80', async () => {
    const pr = makePrWithFile()
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    })

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
      patchCoverage: 90, // >= 80 → 'pass'
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)

    // updateQueuePrRisk was called — verify signalDots included
    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.coverage).toBe('pass')
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268) — coverageDot=warn when avgCoverage is 50-79', () => {
  it('coverageDot=warn when avgCoverage is 50-79', async () => {
    const pr = makePrWithFile()
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    })

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
      patchCoverage: 60, // >= 50 but < 80 → 'warn'
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.coverage).toBe('warn')
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268) — coverageDot=fail when avgCoverage < 50', () => {
  it('coverageDot=fail when avgCoverage < 50', async () => {
    const pr = makePrWithFile()
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    })

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
      patchCoverage: 30, // < 50 → 'fail'
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.coverage).toBe('fail')
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268) — ciDot=fail when pr.ciStatus=failing', () => {
  it('ciDot=fail when pr.ciStatus=failing', async () => {
    const pr = makePrWithFile('failing')
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    })

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.ci).toBe('fail')
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268) — ciDot=warn when pr.ciStatus=pending', () => {
  it('ciDot=warn when pr.ciStatus=pending', async () => {
    const pr = makePrWithFile('pending')
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    })

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.ci).toBe('warn')
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268) — ciDot=unknown when pr.ciStatus=none', () => {
  it('ciDot=unknown when pr.ciStatus=none', async () => {
    const pr = makePrWithFile('none')
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    })

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.ci).toBe('unknown')
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268) — accepts prDetail argument instead of activePr', () => {
  it('accepts prDetail argument instead of activePr', async () => {
    // useFetchFileMetrics with explicit prDetail arg (prDetail ?? activePr branch)
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: null, // no activePr
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    })

    const prDetail = makePrWithFile()

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current, prDetail)

    expect(mockFileMetrics).toHaveBeenCalledWith('/repo', 'src/foo.ts')
    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
  })
})

describe('useLoadInlineComments — catch branch (line 309)', () => {
  it('handles thrown exceptions gracefully', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setThreads: mockSetThreads,
    })

    mockPrInlineComments.mockRejectedValue(new Error('connection refused'))

    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)

    // Should not crash, setThreads should not be called
    expect(mockSetThreads).not.toHaveBeenCalled()
  })
})

describe('useLoadIssueComments', () => {
  beforeEach(() => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setIssueComments: mockSetIssueComments,
    })
  })

  it('does nothing when repoRoot is null', async () => {
    const { result } = renderHook(() => useLoadIssueComments(null))
    await load(result.current)
    expect(mockPrIssueCommentsAPI).not.toHaveBeenCalled()
  })
})

describe('useLoadIssueComments — does nothing when no prNumber (no activePr and no override)', () => {
  beforeEach(() => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setIssueComments: mockSetIssueComments,
    })
  })

  it('does nothing when no prNumber (no activePr and no override)', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: null,
      setIssueComments: mockSetIssueComments,
    })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current)
    expect(mockPrIssueCommentsAPI).not.toHaveBeenCalled()
  })
})

describe('useLoadIssueComments — loads comments using activePr.number when no override given', () => {
  beforeEach(() => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setIssueComments: mockSetIssueComments,
    })
  })

  it('loads comments using activePr.number when no override given', async () => {
    const comments = [
      { id: 1, author: 'alice', authorAvatarUrl: '', body: 'hi', createdAt: '', updatedAt: '' },
    ]
    mockPrIssueCommentsAPI.mockResolvedValue({ comments })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current)

    expect(mockPrIssueCommentsAPI).toHaveBeenCalledWith('/repo', validActivePr.number)
    expect(mockSetIssueComments).toHaveBeenCalledWith(comments)
  })
})

describe('useLoadIssueComments — loads comments using prNumber override', () => {
  beforeEach(() => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setIssueComments: mockSetIssueComments,
    })
  })

  it('loads comments using prNumber override', async () => {
    const comments = [
      { id: 2, author: 'bob', authorAvatarUrl: '', body: 'ok', createdAt: '', updatedAt: '' },
    ]
    mockPrIssueCommentsAPI.mockResolvedValue({ comments })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current, 99)

    expect(mockPrIssueCommentsAPI).toHaveBeenCalledWith('/repo', 99)
    expect(mockSetIssueComments).toHaveBeenCalledWith(comments)
  })
})

describe('useLoadIssueComments — does not call setIssueComments when result contains an error', () => {
  beforeEach(() => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setIssueComments: mockSetIssueComments,
    })
  })

  it('does not call setIssueComments when result contains an error', async () => {
    mockPrIssueCommentsAPI.mockResolvedValue({ error: 'NOT_AUTHENTICATED' })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current)

    expect(mockSetIssueComments).not.toHaveBeenCalled()
  })
})

describe('useLoadIssueComments — handles thrown exceptions gracefully without crashing', () => {
  beforeEach(() => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setIssueComments: mockSetIssueComments,
    })
  })

  it('handles thrown exceptions gracefully without crashing', async () => {
    mockPrIssueCommentsAPI.mockRejectedValue(new Error('network fail'))

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current)

    expect(mockSetIssueComments).not.toHaveBeenCalled()
  })
})

describe('useFetchFileMetrics — one batched request', () => {
  it('asks for every non-generated file in one call and applies the scores in one update', async () => {
    const one = chapterWithFiles('ch-1', [
      file('src/a.ts'),
      file('src/b.ts'),
      file('package-lock.json', 3),
    ])
    withActivePr({
      ...validActivePr,
      chapters: [one, chapterWithFiles('ch-2', [file('src/c.ts')])],
    })
    metricsAnswer({ churn90d: 1, blastRadius: 1 })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(mockFilesMetricsAPI).toHaveBeenCalledTimes(1)
    expect(mockFilesMetricsAPI).toHaveBeenCalledWith('/repo', ['src/a.ts', 'src/b.ts', 'src/c.ts'])
    expect(mockUpdateFileRiskScores).toHaveBeenCalledTimes(1)
    expect(Object.keys(mockUpdateFileRiskScores.mock.calls[0][0]).sort()).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ])
  })
})

const setActive = (pr: typeof validActivePr | null) =>
  vi.mocked(usePrReviewStore).mockReturnValue({
    ...vi.mocked(usePrReviewStore)(),
    activePr: pr,
    setThreads: mockSetThreads,
    setIssueComments: mockSetIssueComments,
  })

/** Mounts a hook that calls the loader it gets whenever the loader changes, and reports when every
 * call has finished. */
function renderLoaderOnEveryChange(useLoader: () => () => Promise<unknown>) {
  const loads: Promise<unknown>[] = []
  const { rerender } = renderHook(() => {
    const load = useLoader()
    useEffect(() => {
      loads.push(load())
    }, [load])
  })
  return {
    rerender,
    settled: () =>
      act(async () => {
        await Promise.all(loads)
      }),
  }
}

describe('comment loaders — stable across activePr patches', () => {
  it('keeps the inline loader identity when activePr is patched for the same PR', () => {
    setActive(validActivePr)
    const { result, rerender } = renderHook(() => useLoadInlineComments('/repo'))
    const first = result.current
    setActive({ ...validActivePr, title: 'patched complexity' })
    rerender()
    expect(result.current).toBe(first)
  })

  it('changes the inline loader identity when a different PR becomes active', () => {
    setActive(validActivePr)
    const { result, rerender } = renderHook(() => useLoadInlineComments('/repo'))
    const first = result.current
    setActive({ ...validActivePr, number: 43 })
    rerender()
    expect(result.current).not.toBe(first)
  })
})

describe('comment loaders — stable across activePr patches — does not fetch inline comments again when activePr is patched', () => {
  it('does not fetch inline comments again when activePr is patched', async () => {
    mockPrInlineComments.mockResolvedValue({ comments: [] })
    setActive(validActivePr)
    const { rerender, settled } = renderLoaderOnEveryChange(() => useLoadInlineComments('/repo'))
    await settled()
    setActive({ ...validActivePr, title: 'patched complexity' })
    rerender()
    await settled()
    expect(mockPrInlineComments).toHaveBeenCalledTimes(1)
  })
})

describe('comment loaders — stable across activePr patches — does not fetch issue comments again when activePr is patched', () => {
  it('does not fetch issue comments again when activePr is patched', async () => {
    mockPrIssueCommentsAPI.mockResolvedValue({ comments: [] })
    setActive(validActivePr)
    const { rerender, settled } = renderLoaderOnEveryChange(() => useLoadIssueComments('/repo'))
    await settled()
    setActive({ ...validActivePr, title: 'patched complexity' })
    rerender()
    await settled()
    expect(mockPrIssueCommentsAPI).toHaveBeenCalledTimes(1)
  })
})
