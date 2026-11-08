import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { renderHook, act } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { computeRiskScore } from '../../src/github/pr-review-service'
import { buildThreads } from '../../src/github/pr-review-service-renderer'
import { reviewQueuePr } from './support/review-queue-pr'
import {
  PrReviewDetailSchema,
  type PrChangedFile,
  type PrReviewDetail,
} from '../../src/schemas/pr-review.schema'
import {
  useLoadPrQueue,
  useLoadPrDetail,
  useFetchFileMetrics,
  useLoadInlineComments,
  useLoadIssueComments,
} from '../../src/hooks/usePrReview'

const mockListOpenPrsAPI = vi.fn()
const mockPrReviewDetailAPI = vi.fn()
const mockFileMetricsAPI = vi.fn()
const mockFilesMetricsAPI = vi.fn()
const mockPrInlineCommentsAPI = vi.fn()
const mockSessionsForRepoAPI = vi.fn()
const mockActiveReviewsForRepoAPI = vi.fn()
const mockPruneActiveReviewsAPI = vi.fn()
const mockCurrentUserAPI = vi.fn()

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
    computeRiskScore: vi.fn(),
  }
})

vi.mock('../../src/github/pr-review-service-renderer', () => ({
  buildThreads: vi.fn(),
}))

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
function prWithFiles(files: ChangedFile[], overrides: Partial<PrReviewDetail> = {}) {
  return { ...validActivePr, ...overrides, chapters: [chapterWithFiles('ch-1', files)] }
}

/** A PR whose one file, src/foo.ts, has no score yet, with CI in `ciStatus`. */
function makePrWithFile(ciStatus: 'passing' | 'failing' | 'pending' | 'none' = 'passing') {
  return prWithFiles([file('src/foo.ts')], { ciStatus, coverageStatus: 'unknown' as const })
}

const store = () => usePrReviewStore.getState()

/** PR 42's queue row, low risk, with every signal dot unknown except CI, which passes. */
function queueRow42() {
  const row = reviewQueuePr(42)
  return { ...row, signalDots: { ...row.signalDots, ci: 'pass' as const } }
}

/** Opens `activePr` in the store, with PR 42 queued. */
function withActivePr(activePr: PrReviewDetail | null) {
  usePrReviewStore.setState({ activePr, prQueue: [queueRow42()] })
}

/** The risk score each of `paths` holds in the open PR. */
function compositeOf(...paths: string[]) {
  const files = store().activePr?.chapters.flatMap((c) => c.files) ?? []
  return paths.map((path) => files.find((f) => f.path === path)?.riskScore.composite)
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

/** The queue the store holds. */
const queuedPrs = () => store().prQueue

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

const LOW_RISK = {
  level: 'low' as const,
  composite: 10,
  dominantDriver: 'changeSize' as const,
  topImporters: [],
  importerCount: 0,
  metrics: { ...NO_METRICS, changeSize: 5 },
}

beforeEach(() => {
  mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
  mockActiveReviewsForRepoAPI.mockResolvedValue({ error: 'NOT_FOUND' })
  mockPruneActiveReviewsAPI.mockResolvedValue({ openNumbers: [] })
  mockCurrentUserAPI.mockResolvedValue({ login: 'testuser' })
  vi.mocked(computeRiskScore).mockReturnValue(LOW_RISK)
  vi.mocked(buildThreads).mockReturnValue([
    { id: 'thread-1', path: 'src/foo.ts', line: 10, startLine: null, comments: [] },
  ] as never)
  usePrReviewStore.setState(usePrReviewStore.getInitialState(), true)
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
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

describe('useLoadPrQueue', () => {
  it('does nothing when repoRoot is null', async () => {
    const { result } = renderHook(() => useLoadPrQueue(null))
    await load(result.current)
    expect(mockListOpenPrs).not.toHaveBeenCalled()
  })
})

describe('useLoadPrQueue — sets queue error when listOpenPrs returns error', () => {
  it('sets queue error when listOpenPrs returns error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'NETWORK_ERROR' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(store().queueError).toBe('NETWORK_ERROR')
  })

  it('sets rate limit state when RATE_LIMITED error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'RATE_LIMITED', resetAt: 99999 })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(store().rateLimitState).toEqual({ resetAt: 99999 })
  })

  it('sets queue error on exception', async () => {
    mockListOpenPrs.mockRejectedValue(new Error('crash'))
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(store().queueError).toContain('crash')
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
    expect(queuedPrs().map((p) => p.number)).toEqual([99])
  })
})

describe('useLoadPrQueue — keeps all orphans when pruneActiveReviews fails', () => {
  it.each([
    ['answers an error', () => ({ error: 'NETWORK_ERROR' })],
    [
      'throws',
      () => {
        throw new Error('bridge disconnected')
      },
    ],
  ])('keeps the orphan queued when prune %s', async (_case, prune) => {
    await loadWithOrphan(orphanPr(55, { sessionStatus: 'paused' }), prune)
    expect(queuedPrs().map((p) => p.number)).toEqual([55])
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

    // The stale, later-arriving response must not replace the fresh result.
    expect(queuedPrs().map((p) => p.number)).toEqual([49])
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
    expect(store().currentUserLogin).toBe('fresh-user')
  })
})

describe('useLoadPrDetail', () => {
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
    expect(store().rateLimitState).toEqual({ resetAt: 12345 })
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
  it('does nothing when activePr is null', async () => {
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)
    expect(mockPrInlineComments).not.toHaveBeenCalled()
  })
})

describe('useLoadInlineComments — calls prInlineComments and sets threads when activePr is set', () => {
  it('calls prInlineComments and sets threads when activePr is set', async () => {
    withActivePr(validActivePr)
    mockPrInlineComments.mockResolvedValue({ comments: [] })
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)
    expect(mockPrInlineComments).toHaveBeenCalledWith('/repo', 42)
    expect(store().threads['src/foo.ts']).toEqual([expect.objectContaining({ id: 'thread-1' })])
  })
})

describe('useLoadInlineComments — a failed load', () => {
  it.each([
    ['answers an error', () => mockPrInlineComments.mockResolvedValue({ error: 'RATE_LIMITED' })],
    ['throws', () => mockPrInlineComments.mockRejectedValue(new Error('connection refused'))],
  ])('sets no threads when the load %s', async (_case, failLoad) => {
    withActivePr(validActivePr)
    failLoad()
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)
    expect(store().threads).toEqual({})
  })
})

describe('useLoadInlineComments — marks a thread resolved when its first comment id is in resolvedCommentIds', () => {
  it('marks a thread resolved when its first comment id is in resolvedCommentIds', async () => {
    withActivePr(validActivePr)
    const comment = reviewComment(1, 't1', 'src/foo.ts')
    const otherComment = reviewComment(2, 't2', 'src/bar.ts')
    vi.mocked(buildThreads).mockReturnValueOnce([threadOf(comment), threadOf(otherComment)])
    mockPrInlineComments.mockResolvedValue({
      comments: [comment, otherComment],
      resolvedCommentIds: [1],
    })
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await load(result.current)
    expect(store().threads['src/foo.ts'][0].resolved).toBe(true)
    expect(store().threads['src/bar.ts'][0].resolved).toBe(false)
  })
})

describe('useFetchFileMetrics', () => {
  it('does nothing when repoRoot is null', async () => {
    withActivePr(validActivePr)
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
    expect(queuedPrs()[0].riskLevel).toBe('high')
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
    // No file was measured, so neither the file nor the queue row gets a score.
    expect(compositeOf('src/foo.ts')).toEqual([null])
    expect(queuedPrs()).toEqual([queueRow42()])
  })
})

describe('useLoadPrQueue — NOT_AUTHENTICATED branch', () => {
  it('sets queue error with auth message when NOT_AUTHENTICATED error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'NOT_AUTHENTICATED' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(store().queueError).toContain('Not authenticated')
  })

  it('uses fallback resetAt when RATE_LIMITED has no resetAt', async () => {
    // resetAt is undefined — falls back to Date.now() + 60_000
    mockListOpenPrs.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await load(result.current)
    expect(store().rateLimitState).toEqual({ resetAt: expect.any(Number) })
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

describe('useLoadPrQueue — NOT_AUTHENTICATED branch — mergeSessionStatuses: session with pausedAt set marks PR as paused', () => {
  it('mergeSessionStatuses: session with pausedAt set marks PR as paused', async () => {
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [storedSession('2026-01-01T00:00:00Z')] })
    const pr42 = { ...reviewQueuePr(42), title: 'Test', sessionStatus: 'not-started' }
    mockListOpenPrs.mockResolvedValue({ prs: [pr42], hasMore: false })
    await loadQueueVia()
    expect(queuedPrs().find((p) => p.number === 42)?.sessionStatus).toBe('paused')
  })
})

describe('useLoadPrDetail — additional branches', () => {
  it('handles RATE_LIMITED with no explicit resetAt (uses fallback)', async () => {
    mockPrReviewDetail.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await load(result.current, 1, vi.fn())
    expect(store().rateLimitState).toEqual({ resetAt: expect.any(Number) })
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

describe('useFetchFileMetrics — the queue row coverage dot', () => {
  it.each([
    [90, 'pass'],
    [60, 'warn'],
    [30, 'fail'],
  ])('sets the coverage dot for %i%% patch coverage to %s', async (patchCoverage, dot) => {
    withActivePr(makePrWithFile())
    metricsAnswer({ patchCoverage })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(queuedPrs()[0].signalDots.coverage).toBe(dot)
  })
})

describe('useFetchFileMetrics — the queue row CI dot', () => {
  it.each([
    ['failing', 'fail'],
    ['pending', 'warn'],
    ['none', 'unknown'],
  ] as const)('sets the CI dot for CI %s to %s', async (ciStatus, dot) => {
    withActivePr(makePrWithFile(ciStatus))
    metricsAnswer()
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(queuedPrs()[0].signalDots.ci).toBe(dot)
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268) — accepts prDetail argument instead of activePr', () => {
  it('accepts prDetail argument instead of activePr', async () => {
    withActivePr(null)
    metricsAnswer()
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current, makePrWithFile())
    expect(mockFileMetrics).toHaveBeenCalledWith('/repo', 'src/foo.ts')
    // The queue row's tests dot moves from unknown: the given PR was scored.
    expect(queuedPrs()[0].signalDots.tests).toBe('pass')
  })
})

describe('useLoadIssueComments', () => {
  beforeEach(() => {
    withActivePr(validActivePr)
  })

  it('does nothing when repoRoot is null', async () => {
    const { result } = renderHook(() => useLoadIssueComments(null))
    await load(result.current)
    expect(mockPrIssueCommentsAPI).not.toHaveBeenCalled()
  })
})

describe('useLoadIssueComments — does nothing when no prNumber (no activePr and no override)', () => {
  beforeEach(() => {
    withActivePr(validActivePr)
  })

  it('does nothing when no prNumber (no activePr and no override)', async () => {
    withActivePr(null)
    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current)
    expect(mockPrIssueCommentsAPI).not.toHaveBeenCalled()
  })
})

describe('useLoadIssueComments — loads comments using activePr.number when no override given', () => {
  beforeEach(() => {
    withActivePr(validActivePr)
  })

  it('loads comments using activePr.number when no override given', async () => {
    const comments = [
      { id: 1, author: 'alice', authorAvatarUrl: '', body: 'hi', createdAt: '', updatedAt: '' },
    ]
    mockPrIssueCommentsAPI.mockResolvedValue({ comments })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current)

    expect(mockPrIssueCommentsAPI).toHaveBeenCalledWith('/repo', validActivePr.number)
    expect(store().issueComments).toEqual(comments)
  })
})

describe('useLoadIssueComments — loads comments using prNumber override', () => {
  beforeEach(() => {
    withActivePr(validActivePr)
  })

  it('loads comments using prNumber override', async () => {
    const comments = [
      { id: 2, author: 'bob', authorAvatarUrl: '', body: 'ok', createdAt: '', updatedAt: '' },
    ]
    mockPrIssueCommentsAPI.mockResolvedValue({ comments })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current, 99)

    expect(mockPrIssueCommentsAPI).toHaveBeenCalledWith('/repo', 99)
    expect(store().issueComments).toEqual(comments)
  })
})

describe('useLoadIssueComments — a failed load', () => {
  it.each([
    [
      'answers an error',
      () => mockPrIssueCommentsAPI.mockResolvedValue({ error: 'NOT_AUTHENTICATED' }),
    ],
    ['throws', () => mockPrIssueCommentsAPI.mockRejectedValue(new Error('network fail'))],
  ])('sets no issue comments when the load %s', async (_case, failLoad) => {
    withActivePr(validActivePr)
    failLoad()
    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await load(result.current)
    expect(store().issueComments).toEqual([])
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
    // The stubbed scorer gives 10; the lock file is not scored.
    expect(compositeOf('src/a.ts', 'src/b.ts', 'src/c.ts', 'package-lock.json')).toEqual([
      10,
      10,
      10,
      null,
    ])
  })
})

const setActive = (pr: PrReviewDetail | null) =>
  act(() => {
    usePrReviewStore.setState({ activePr: pr })
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
