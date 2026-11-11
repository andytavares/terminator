import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { renderHook, act } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
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
const mockFilesMetricsAPI = vi.fn()
const mockBlastRadiusAPI = vi.fn()
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
    filesMetrics: (...args: unknown[]) => mockFilesMetricsAPI(...args),
    blastRadius: (...args: unknown[]) => mockBlastRadiusAPI(...args),
    prInlineComments: (...args: unknown[]) => mockPrInlineCommentsAPI(...args),
    prIssueComments: (...args: unknown[]) => mockPrIssueCommentsAPI(...args),
    sessionsForRepo: (...args: unknown[]) => mockSessionsForRepoAPI(...args),
    activeReviewsForRepo: (...args: unknown[]) => mockActiveReviewsForRepoAPI(...args),
    pruneActiveReviews: (...args: unknown[]) => mockPruneActiveReviewsAPI(...args),
  },
}))

vi.mock('../../src/github/pr-review-service-renderer', () => ({
  buildThreads: vi.fn(),
}))

// Aliases so test assertions work without changes
const mockListOpenPrs = mockListOpenPrsAPI
const mockPrReviewDetail = mockPrReviewDetailAPI
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
  chapters: [],
})

type ChangedFile = ReturnType<typeof file>

/** A modified file at `path`, not yet measured. */
function file(path: string): PrChangedFile {
  return {
    path,
    changeType: 'modified' as const,
    additions: 4,
    deletions: 1,
    isBinary: false,
    whyHere: 'changed',
    churn90d: null,
    blastRadius: null,
  }
}

/** A chapter holding `files`. */
function chapterWithFiles(id: string, files: ChangedFile[]) {
  return { id, name: id, status: 'not-started' as const, files }
}

/** The active PR with one chapter of `files`. */
function prWithFiles(files: ChangedFile[], overrides: Partial<PrReviewDetail> = {}) {
  return { ...validActivePr, ...overrides, chapters: [chapterWithFiles('ch-1', files)] }
}

const store = () => usePrReviewStore.getState()

/** Opens `activePr` in the store, with PR 42 queued. */
function withActivePr(activePr: PrReviewDetail | null) {
  usePrReviewStore.setState({ activePr, prQueue: [reviewQueuePr(42)] })
}

/** The 90-day commit count each of `paths` holds in the open PR. */
function churnOf(...paths: string[]) {
  const files = store().activePr?.chapters.flatMap((c) => c.files) ?? []
  return paths.map((path) => files.find((f) => f.path === path)?.churn90d)
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

beforeEach(() => {
  mockBlastRadiusAPI.mockResolvedValue({ radius: {} })
  mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
  mockActiveReviewsForRepoAPI.mockResolvedValue({ error: 'NOT_FOUND' })
  mockPruneActiveReviewsAPI.mockResolvedValue({ openNumbers: [] })
  mockCurrentUserAPI.mockResolvedValue({ login: 'testuser' })
  vi.mocked(buildThreads).mockReturnValue([
    { id: 'thread-1', path: 'src/foo.ts', line: 10, startLine: null, comments: [] },
  ] as never)
  usePrReviewStore.setState(usePrReviewStore.getInitialState(), true)
  Object.assign(globalThis, {
    electronAPI: {
      github: {
        listOpenPrs: mockListOpenPrs,
        prReviewDetail: mockPrReviewDetail,
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

/** What loading PR 7 of `repoRoot` resolves to: null when it opened, else the reason it did not. */
async function openFailure(repoRoot: string | null = '/repo') {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = renderHook(() => useLoadPrDetail(repoRoot))
  let message: string | null = null
  await act(async () => {
    message = await result.current(7, vi.fn().mockResolvedValue(undefined))
  })
  return message
}

describe('useLoadPrDetail — the reason a pull request did not open', () => {
  it('says no repository was given, and asks GitHub nothing, when repoRoot is null', async () => {
    expect(await openFailure(null)).toBe('No repository given')
    expect(mockPrReviewDetail).not.toHaveBeenCalled()
  })

  it('passes on the error text the channel sent', async () => {
    mockPrReviewDetail.mockResolvedValue({ error: 'gh: HTTP 502 Bad Gateway' })
    expect(await openFailure()).toBe('gh: HTTP 502 Bad Gateway')
  })

  it('names the local time GitHub lifts its rate limit at', async () => {
    mockPrReviewDetail.mockResolvedValue({
      error: 'RATE_LIMITED',
      resetAt: Date.UTC(2026, 10, 9, 14, 30),
    })
    expect(await openFailure()).toBe('GitHub limited requests until 14:30')
  })

  it('says the view cannot read pull request data that fails the schema', async () => {
    mockPrReviewDetail.mockResolvedValue({ pr: { invalid: true } })
    expect(await openFailure()).toBe('GitHub sent pull request data this view cannot read')
  })

  it('passes on the message of a thrown error', async () => {
    mockPrReviewDetail.mockRejectedValue(new Error('connection refused'))
    expect(await openFailure()).toBe('connection refused')
  })

  it('resolves to null when the pull request opened', async () => {
    mockPrReviewDetail.mockResolvedValue({ pr: validActivePr })
    expect(await openFailure()).toBeNull()
  })
})

describe('useLoadPrDetail', () => {
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
    expect(mockFilesMetricsAPI).not.toHaveBeenCalled()
  })

  it('does nothing when no activePr and no prDetail arg', async () => {
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(mockFilesMetricsAPI).not.toHaveBeenCalled()
  })
})

describe('useFetchFileMetrics — a failed metrics answer', () => {
  it('leaves every file unmeasured when the channel answers an error', async () => {
    withActivePr(prWithFiles([file('src/foo.ts')]))
    mockFilesMetricsAPI.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(churnOf('src/foo.ts')).toEqual([null])
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

describe('useFetchFileMetrics — accepts prDetail argument instead of activePr', () => {
  it('measures the given PR when none is open', async () => {
    withActivePr(null)
    mockFilesMetricsAPI.mockResolvedValue({ metrics: { 'src/foo.ts': { churn90d: 3 } } })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current, prWithFiles([file('src/foo.ts')]))
    expect(mockFilesMetricsAPI).toHaveBeenCalledWith('/repo', ['src/foo.ts'])
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
  it("asks for every file in one call and sets each file's churn", async () => {
    const one = chapterWithFiles('ch-1', [file('src/a.ts'), file('package-lock.json')])
    withActivePr({
      ...validActivePr,
      chapters: [one, chapterWithFiles('ch-2', [file('src/c.ts')])],
    })
    mockFilesMetricsAPI.mockResolvedValue({
      metrics: {
        'src/a.ts': { churn90d: 7 },
        'package-lock.json': { churn90d: 2 },
        'src/c.ts': { churn90d: 0 },
      },
    })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(mockFilesMetricsAPI).toHaveBeenCalledTimes(1)
    expect(mockFilesMetricsAPI).toHaveBeenCalledWith('/repo', [
      'src/a.ts',
      'package-lock.json',
      'src/c.ts',
    ])
    expect(churnOf('src/a.ts', 'package-lock.json', 'src/c.ts')).toEqual([7, 2, 0])
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

/** The blast radius each of `paths` holds in the open PR. */
function blastRadiusOf(...paths: string[]) {
  const files = store().activePr?.chapters.flatMap((c) => c.files) ?? []
  return paths.map((path) => files.find((f) => f.path === path)?.blastRadius)
}

describe('useFetchFileMetrics — blast radius', () => {
  it("asks for the PR head's blast radius and sets each file's", async () => {
    withActivePr(prWithFiles([file('src/a.ts'), file('README.md')]))
    mockFilesMetricsAPI.mockResolvedValue({ metrics: {} })
    mockBlastRadiusAPI.mockResolvedValue({
      radius: { 'src/a.ts': { usedIn: 14, alsoDefinedIn: 2 }, 'README.md': null },
    })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(mockBlastRadiusAPI).toHaveBeenCalledWith('/repo', 42, 'abc123')
    expect(blastRadiusOf('src/a.ts', 'README.md')).toEqual([{ usedIn: 14, alsoDefinedIn: 2 }, null])
  })

  it('leaves every file unmeasured when the channel answers an error', async () => {
    withActivePr(prWithFiles([file('src/a.ts')]))
    mockFilesMetricsAPI.mockResolvedValue({ metrics: {} })
    mockBlastRadiusAPI.mockResolvedValue({ error: 'VALIDATION_ERROR' })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await load(result.current)
    expect(blastRadiusOf('src/a.ts')).toEqual([null])
  })
})
