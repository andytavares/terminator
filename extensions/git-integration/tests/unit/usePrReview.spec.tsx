import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { renderHook, act } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
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
    fileMetrics: (...args: unknown[]) => mockFileMetricsAPI(...args),
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

const validActivePr = {
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
}

beforeEach(() => {
  vi.clearAllMocks()
  // The hooks read the live PR through getState(); serve whatever the test configured.
  ;(usePrReviewStore as unknown as { getState: () => unknown }).getState = () =>
    vi.mocked(usePrReviewStore)()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    github: {
      listOpenPrs: mockListOpenPrs,
      prReviewDetail: mockPrReviewDetail,
      fileMetrics: mockFileMetrics,
      prInlineComments: mockPrInlineComments,
    },
  }
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
  } as unknown as ReturnType<typeof usePrReviewStore>)
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('useLoadPrQueue', () => {
  it('returns a function', () => {
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    expect(typeof result.current).toBe('function')
  })

  it('does nothing when repoRoot is null', async () => {
    const { result } = renderHook(() => useLoadPrQueue(null))
    await act(async () => {
      await result.current()
    })
    expect(mockListOpenPrs).not.toHaveBeenCalled()
  })

  it('calls listOpenPrs and sets queue on success', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockListOpenPrs).toHaveBeenCalledWith('/repo', expect.any(Object))
    expect(mockSetQueue).toHaveBeenCalled()
  })

  it('sets queue error when listOpenPrs returns error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'NETWORK_ERROR' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockSetQueueError).toHaveBeenCalledWith('NETWORK_ERROR')
  })

  it('sets rate limit state when RATE_LIMITED error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'RATE_LIMITED', resetAt: 99999 })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockSetRateLimitState).toHaveBeenCalledWith({ resetAt: 99999 })
  })

  it('sets queue error on exception', async () => {
    mockListOpenPrs.mockRejectedValue(new Error('crash'))
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockSetQueueError).toHaveBeenCalledWith(expect.stringContaining('crash'))
  })

  it('appends to queue when append option is true', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current({ append: true })
    })
    expect(mockAppendQueue).toHaveBeenCalled()
    expect(mockSetQueue).not.toHaveBeenCalled()
  })

  it('excludes orphan PRs when pruneActiveReviews reports them closed/merged', async () => {
    const orphanPr = {
      number: 99,
      title: 'Orphan PR',
      author: 'bob',
      authorAvatarUrl: '',
      openedAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat',
      baseRefName: 'main',
      isDraft: false,
      ciStatus: 'none',
      fileCount: 1,
      additions: 5,
      deletions: 2,
      estimatedMinutes: 5,
      riskLevel: 'low',
      signalDots: {
        tests: 'unknown',
        coverage: 'unknown',
        ci: 'unknown',
        lint: 'unknown',
        churn: 'unknown',
        blast: 'unknown',
      },
      sessionStatus: 'in-progress',
      viewedFileCount: 1,
    }
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false })
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
    mockActiveReviewsForRepoAPI.mockResolvedValue({ prs: [orphanPr] })
    // pruneActiveReviews returns empty openNumbers → PR 99 is closed/merged
    mockPruneActiveReviewsAPI.mockResolvedValue({ openNumbers: [] })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    const queue = mockSetQueue.mock.calls[0]?.[0] ?? []
    expect(queue.find((p: { number: number }) => p.number === 99)).toBeUndefined()
  })

  it('includes orphan PRs when pruneActiveReviews confirms they are still open', async () => {
    const orphanPr = {
      number: 99,
      title: 'Orphan PR',
      author: 'bob',
      authorAvatarUrl: '',
      openedAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat',
      baseRefName: 'main',
      isDraft: false,
      ciStatus: 'none',
      fileCount: 1,
      additions: 5,
      deletions: 2,
      estimatedMinutes: 5,
      riskLevel: 'low',
      signalDots: {
        tests: 'unknown',
        coverage: 'unknown',
        ci: 'unknown',
        lint: 'unknown',
        churn: 'unknown',
        blast: 'unknown',
      },
      sessionStatus: 'in-progress',
      viewedFileCount: 1,
    }
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: true, nextCursor: 'cursor-1' })
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
    mockActiveReviewsForRepoAPI.mockResolvedValue({ prs: [orphanPr] })
    // pruneActiveReviews returns 99 → PR is still open (just on a later page)
    mockPruneActiveReviewsAPI.mockResolvedValue({ openNumbers: [99] })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    const queue = mockSetQueue.mock.calls[0]?.[0] ?? []
    expect(queue.find((p: { number: number }) => p.number === 99)).toBeDefined()
  })

  it('keeps all orphans when pruneActiveReviews returns an error object', async () => {
    const orphanPr = {
      number: 55,
      title: 'Orphan',
      author: 'carol',
      authorAvatarUrl: '',
      openedAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat',
      baseRefName: 'main',
      isDraft: false,
      ciStatus: 'none',
      fileCount: 1,
      additions: 1,
      deletions: 0,
      estimatedMinutes: 2,
      riskLevel: 'low',
      signalDots: {
        tests: 'unknown',
        coverage: 'unknown',
        ci: 'unknown',
        lint: 'unknown',
        churn: 'unknown',
        blast: 'unknown',
      },
      sessionStatus: 'in-progress',
      viewedFileCount: 0,
    }
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false })
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
    mockActiveReviewsForRepoAPI.mockResolvedValue({ prs: [orphanPr] })
    // pruneActiveReviews returns an error — orphan should still appear
    mockPruneActiveReviewsAPI.mockResolvedValue({ error: 'NETWORK_ERROR' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    const queue = mockSetQueue.mock.calls[0]?.[0] ?? []
    expect(queue.find((p: { number: number }) => p.number === 55)).toBeDefined()
  })

  it('keeps all orphans when pruneActiveReviews throws', async () => {
    const orphanPr = {
      number: 66,
      title: 'Orphan throw',
      author: 'dave',
      authorAvatarUrl: '',
      openedAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat',
      baseRefName: 'main',
      isDraft: false,
      ciStatus: 'none',
      fileCount: 1,
      additions: 1,
      deletions: 0,
      estimatedMinutes: 2,
      riskLevel: 'low',
      signalDots: {
        tests: 'unknown',
        coverage: 'unknown',
        ci: 'unknown',
        lint: 'unknown',
        churn: 'unknown',
        blast: 'unknown',
      },
      sessionStatus: 'paused',
      viewedFileCount: 0,
    }
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false })
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
    mockActiveReviewsForRepoAPI.mockResolvedValue({ prs: [orphanPr] })
    // pruneActiveReviews throws — orphan should still appear
    mockPruneActiveReviewsAPI.mockRejectedValue(new Error('bridge disconnected'))
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    const queue = mockSetQueue.mock.calls[0]?.[0] ?? []
    expect(queue.find((p: { number: number }) => p.number === 66)).toBeDefined()
  })

  it('sets hasMorePrs and nextCursor from response', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: true, nextCursor: 'cursor-abc' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockSetHasMorePrs).toHaveBeenCalledWith(true)
    expect(mockSetNextPrCursor).toHaveBeenCalledWith('cursor-abc')
  })

  it('uses setLoadingMorePrs when appending', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current({ append: true })
    })
    expect(mockSetLoadingMorePrs).toHaveBeenCalledWith(true)
    expect(mockSetLoadingMorePrs).toHaveBeenCalledWith(false)
  })

  it('TAV-7: discards a stale response that resolves after a newer request', async () => {
    // Simulates pasting "049": an earlier query's slower response (e.g. a
    // broader text search) resolves *after* a later query's faster response
    // (e.g. the exact PR-number lookup). The stale response must not clobber
    // the newer, correct result.
    let resolveStale!: (v: unknown) => void
    let resolveFresh!: (v: unknown) => void
    const basePr = {
      author: 'alice',
      authorAvatarUrl: '',
      openedAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      ciStatus: 'none' as const,
      fileCount: 1,
      additions: 0,
      deletions: 0,
      estimatedMinutes: 1,
      riskLevel: 'low' as const,
      signalDots: {
        tests: 'unknown' as const,
        coverage: 'unknown' as const,
        ci: 'unknown' as const,
        lint: 'unknown' as const,
        churn: 'unknown' as const,
        blast: 'unknown' as const,
      },
      sessionStatus: 'not-started' as const,
      viewedFileCount: 0,
    }
    const stalePr = { ...basePr, number: 50, title: 'Stale match' }
    const freshPr = { ...basePr, number: 49, title: 'Fresh match' }
    mockSessionsForRepoAPI.mockResolvedValue({ sessions: [] })
    mockActiveReviewsForRepoAPI.mockResolvedValue({ error: 'NOT_FOUND' })
    mockListOpenPrs
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFresh = resolve
          })
      )

    const { result } = renderHook(() => useLoadPrQueue('/repo'))

    const staleCall = result.current({ search: '04' })
    const freshCall = result.current({ search: '049' })

    // Fresh (later-issued) request resolves first...
    resolveFresh({ prs: [freshPr], hasMore: false, nextCursor: undefined })
    await act(async () => {
      await freshCall
    })
    // ...then the stale (earlier-issued) request resolves after it.
    resolveStale({ prs: [stalePr], hasMore: false, nextCursor: undefined })
    await act(async () => {
      await staleCall
    })

    // setQueue must have been called exactly once, with the fresh result —
    // the stale, later-arriving response must be discarded.
    expect(mockSetQueue).toHaveBeenCalledTimes(1)
    expect(mockSetQueue).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ number: 49 })])
    )
  })

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
    await act(async () => {
      await result.current(1, vi.fn())
    })
    expect(mockPrReviewDetail).not.toHaveBeenCalled()
  })

  it('calls prReviewDetail and invokes onSuccess callback with parsed data', async () => {
    mockPrReviewDetail.mockResolvedValue({ pr: validActivePr })
    const onSuccess = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await act(async () => {
      await result.current(42, onSuccess)
    })
    expect(mockPrReviewDetail).toHaveBeenCalledWith('/repo', 42)
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ number: 42 }))
  })

  it('does not call onSuccess when result has error', async () => {
    mockPrReviewDetail.mockResolvedValue({ error: 'NETWORK_ERROR' })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await act(async () => {
      await result.current(1, onSuccess)
    })
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('handles RATE_LIMITED error', async () => {
    mockPrReviewDetail.mockResolvedValue({ error: 'RATE_LIMITED', resetAt: 12345 })
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await act(async () => {
      await result.current(1, vi.fn())
    })
    expect(mockSetRateLimitState).toHaveBeenCalledWith({ resetAt: 12345 })
  })

  it('does not crash on exception', async () => {
    mockPrReviewDetail.mockRejectedValue(new Error('network fail'))
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await act(async () => {
      await result.current(1, vi.fn())
    })
    // should not throw
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
    } as unknown as ReturnType<typeof usePrReviewStore>)
    const { result } = renderHook(() => useLoadInlineComments(null))
    await act(async () => {
      await result.current()
    })
    expect(mockPrInlineComments).not.toHaveBeenCalled()
  })

  it('does nothing when activePr is null', async () => {
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockPrInlineComments).not.toHaveBeenCalled()
  })

  it('calls prInlineComments and sets threads when activePr is set', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setThreads: mockSetThreads,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    mockPrInlineComments.mockResolvedValue({ comments: [] })
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockPrInlineComments).toHaveBeenCalledWith('/repo', 42)
    expect(mockSetThreads).toHaveBeenCalled()
  })

  it('does nothing when result has error', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setThreads: mockSetThreads,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    mockPrInlineComments.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockSetThreads).not.toHaveBeenCalled()
  })

  it('marks a thread resolved when its first comment id is in resolvedCommentIds', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: validActivePr,
      setThreads: mockSetThreads,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    const { buildThreads } = await import('../../src/github/pr-review-service-renderer')
    const baseComment = {
      id: 1,
      author: 'alice',
      authorAvatarUrl: '',
      body: 'hi',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      path: 'src/foo.ts',
      line: 10,
      startLine: null,
      side: 'RIGHT' as const,
      diffHunk: '',
      outdated: false,
      threadId: 't1',
      isReply: false,
      parentId: null,
    }
    const otherComment = { ...baseComment, id: 2, threadId: 't2', path: 'src/bar.ts' }
    vi.mocked(buildThreads).mockReturnValueOnce([
      {
        id: 't1',
        path: 'src/foo.ts',
        line: 10,
        startLine: null,
        side: 'RIGHT',
        outdated: false,
        comments: [baseComment],
        collapsed: false,
        resolved: false,
      },
      {
        id: 't2',
        path: 'src/bar.ts',
        line: 10,
        startLine: null,
        side: 'RIGHT',
        outdated: false,
        comments: [otherComment],
        collapsed: false,
        resolved: false,
      },
    ])
    mockPrInlineComments.mockResolvedValue({
      comments: [baseComment, otherComment],
      resolvedCommentIds: [1],
    })
    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await act(async () => {
      await result.current()
    })
    const calls = mockSetThreads.mock.calls
    const fooCall = calls.find((c) => c[0] === 'src/foo.ts')
    const barCall = calls.find((c) => c[0] === 'src/bar.ts')
    expect(fooCall?.[1][0].resolved).toBe(true)
    expect(barCall?.[1][0].resolved).toBe(false)
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
    } as unknown as ReturnType<typeof usePrReviewStore>)
    const { result } = renderHook(() => useFetchFileMetrics(null))
    await act(async () => {
      await result.current()
    })
    expect(mockFileMetrics).not.toHaveBeenCalled()
  })

  it('does nothing when no activePr and no prDetail arg', async () => {
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockFileMetrics).not.toHaveBeenCalled()
  })

  it('fetches file metrics and updates risk scores for chapters with files', async () => {
    const prWithFiles = {
      ...validActivePr,
      chapters: [
        {
          id: 'ch-1',
          name: 'Chapter 1',
          estimatedMinutes: 5,
          status: 'not-started' as const,
          files: [
            {
              path: 'src/foo.ts',
              oldPath: undefined,
              changeType: 'modified' as const,
              additions: 10,
              deletions: 2,
              isBinary: false,
              tier: 1 as const,
              whyHere: 'changed',
              estimatedMinutes: 3,
              riskScore: {
                level: 'low' as const,
                composite: 5,
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
              },
            },
          ],
        },
      ],
    }
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: prWithFiles,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockFileMetrics).toHaveBeenCalledWith('/repo', 'src/foo.ts')
    expect(mockUpdateFileRiskScores).toHaveBeenCalled()
    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
  })

  it('keeps a large but mechanically-simple PR at high risk via the size floor', async () => {
    const prBigSimple = {
      ...validActivePr,
      chapters: [
        {
          id: 'ch-1',
          name: 'Chapter 1',
          estimatedMinutes: 9,
          status: 'not-started' as const,
          files: [
            {
              path: 'src/big.ts',
              oldPath: undefined,
              changeType: 'modified' as const,
              additions: 500,
              deletions: 0,
              isBinary: false,
              tier: 1 as const,
              whyHere: 'changed',
              estimatedMinutes: 9,
              riskScore: {
                level: 'low' as const,
                composite: 5,
                dominantDriver: 'changeSize',
                topImporters: [],
                importerCount: 0,
                metrics: {
                  changeSize: 500,
                  churn90d: null,
                  blastRadius: null,
                  testFilePresent: null,
                  complexityDelta: null,
                  patchCoverage: null,
                },
              },
            },
          ],
        },
      ],
    }
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: prBigSimple,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    // Low per-file signals → per-file risk is 'low', but 500 lines changed
    // must still resolve to 'high' because of the size floor.
    mockFileMetrics.mockResolvedValue({
      churn90d: 1,
      blastRadius: 1,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })
    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockUpdateQueuePrRisk).toHaveBeenCalledWith(42, 'high', expect.anything())
  })

  it('does nothing when all files are tier-3 (lock files excluded from risk scoring)', async () => {
    const prWithLockFiles = {
      ...validActivePr,
      chapters: [
        {
          id: 'ch-1',
          name: 'Chapter 1',
          estimatedMinutes: 1,
          status: 'not-started' as const,
          files: [
            {
              path: 'package-lock.json',
              oldPath: undefined,
              changeType: 'modified' as const,
              additions: 1000,
              deletions: 1000,
              isBinary: false,
              tier: 3 as const, // tier 3 — excluded
              whyHere: 'Mechanical change',
              estimatedMinutes: 1,
              riskScore: {
                level: 'low' as const,
                composite: null,
                dominantDriver: '',
                topImporters: [],
                importerCount: 0,
                metrics: {
                  changeSize: null,
                  churn90d: null,
                  blastRadius: null,
                  testFilePresent: null,
                  complexityDelta: null,
                  patchCoverage: null,
                },
              },
            },
          ],
        },
      ],
    }
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: prWithLockFiles,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })
    // Tier 3 files are excluded, so no metrics calls
    expect(mockFileMetrics).not.toHaveBeenCalled()
  })

  it('handles fileMetrics returning an error object (null value)', async () => {
    const prWithFiles = {
      ...validActivePr,
      chapters: [
        {
          id: 'ch-1',
          name: 'Chapter 1',
          estimatedMinutes: 5,
          status: 'not-started' as const,
          files: [
            {
              path: 'src/foo.ts',
              oldPath: undefined,
              changeType: 'modified' as const,
              additions: 10,
              deletions: 2,
              isBinary: false,
              tier: 1 as const,
              whyHere: 'changed',
              estimatedMinutes: 3,
              riskScore: {
                level: 'low' as const,
                composite: null,
                dominantDriver: '',
                topImporters: [],
                importerCount: 0,
                metrics: {
                  changeSize: null,
                  churn90d: null,
                  blastRadius: null,
                  testFilePresent: null,
                  complexityDelta: null,
                  patchCoverage: null,
                },
              },
            },
          ],
        },
      ],
    }
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: prWithFiles,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    // Return an error — should produce null (filtered out)
    mockFileMetrics.mockResolvedValue({ error: 'RATE_LIMITED' })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })
    // collected.length === 0 so no updateFileRiskScore or updateQueuePrRisk
    expect(mockUpdateFileRiskScores).not.toHaveBeenCalled()
    expect(mockUpdateQueuePrRisk).not.toHaveBeenCalled()
  })
})

describe('useLoadPrQueue — NOT_AUTHENTICATED branch', () => {
  it('sets queue error with auth message when NOT_AUTHENTICATED error', async () => {
    mockListOpenPrs.mockResolvedValue({ error: 'NOT_AUTHENTICATED' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockSetQueueError).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'))
  })

  it('uses fallback resetAt when RATE_LIMITED has no resetAt', async () => {
    // resetAt is undefined — falls back to Date.now() + 60_000
    mockListOpenPrs.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockSetRateLimitState).toHaveBeenCalledWith({
      resetAt: expect.any(Number),
    })
  })

  it('passes cursor and search options to listOpenPrs', async () => {
    mockListOpenPrs.mockResolvedValue({ prs: [], hasMore: false, nextCursor: undefined })
    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current({ cursor: 'cursor-123', search: 'fix bug' })
    })
    expect(mockListOpenPrs).toHaveBeenCalledWith('/repo', {
      cursor: 'cursor-123',
      search: 'fix bug',
    })
  })

  it('mergeSessionStatuses: session with pausedAt=null is in-progress', async () => {
    mockSessionsForRepoAPI.mockResolvedValue({
      sessions: [
        {
          repoRoot: '/repo',
          prNumber: 42,
          headSHA: 'abc123',
          currentChapterId: null,
          currentFilePath: null,
          viewedFiles: ['src/foo.ts'],
          fileOrderOverrides: {},
          scrollPosition: null,
          pausedAt: null, // in-progress (not paused)
          lastAccessedAt: '2026-01-01T00:00:00Z',
        },
      ],
    })

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
    await act(async () => {
      await result.current()
    })

    // Should call sessionsForRepo to merge statuses
    expect(mockSessionsForRepoAPI).toHaveBeenCalledWith('/repo')
    // Queue should be set (with merged session status)
    expect(mockSetQueue).toHaveBeenCalled()
  })

  it('mergeSessionStatuses: session with pausedAt set marks PR as paused', async () => {
    mockSessionsForRepoAPI.mockResolvedValue({
      sessions: [
        {
          repoRoot: '/repo',
          prNumber: 42,
          headSHA: 'abc123',
          currentChapterId: null,
          currentFilePath: null,
          viewedFiles: ['src/foo.ts'],
          fileOrderOverrides: {},
          scrollPosition: null,
          pausedAt: '2026-01-01T00:00:00Z', // paused
          lastAccessedAt: '2026-01-01T00:00:00Z',
        },
      ],
    })

    const prData = {
      number: 42,
      title: 'Test',
      author: 'alice',
      authorAvatarUrl: '',
      openedAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      ciStatus: 'none',
      fileCount: 1,
      additions: 0,
      deletions: 0,
      estimatedMinutes: 1,
      riskLevel: 'low',
      signalDots: {
        tests: 'unknown',
        coverage: 'unknown',
        ci: 'unknown',
        lint: 'unknown',
        churn: 'unknown',
        blast: 'unknown',
      },
      sessionStatus: 'not-started',
      viewedFileCount: 0,
    }

    mockListOpenPrs.mockResolvedValue({ prs: [prData], hasMore: false })

    const { result } = renderHook(() => useLoadPrQueue('/repo'))
    await act(async () => {
      await result.current()
    })

    const queue = mockSetQueue.mock.calls[0]?.[0] ?? []
    expect(queue.find((p: { number: number }) => p.number === 42)?.sessionStatus).toBe('paused')
  })

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
    await act(async () => {
      await result.current()
    })

    // Should still set queue (with original prs, fallback on error)
    expect(mockSetQueue).toHaveBeenCalled()
  })
})

describe('useLoadPrDetail — additional branches', () => {
  it('handles RATE_LIMITED with no explicit resetAt (uses fallback)', async () => {
    mockPrReviewDetail.mockResolvedValue({ error: 'RATE_LIMITED' })
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await act(async () => {
      await result.current(1, vi.fn())
    })
    expect(mockSetRateLimitState).toHaveBeenCalledWith({
      resetAt: expect.any(Number),
    })
  })

  it('does not call onSuccess when parsed schema fails', async () => {
    // Return a pr object that fails schema validation
    mockPrReviewDetail.mockResolvedValue({ pr: { invalid: true } })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useLoadPrDetail('/repo'))
    await act(async () => {
      await result.current(1, onSuccess)
    })
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('useFetchFileMetrics — avgCoverage branches (lines 264-268)', () => {
  function makePrWithFile(
    patchCoverage: number | null,
    ciStatus: 'passing' | 'failing' | 'pending' | 'none' = 'passing'
  ) {
    return {
      ...validActivePr,
      ciStatus,
      coverageStatus: 'unknown' as const,
      chapters: [
        {
          id: 'ch-1',
          name: 'Chapter 1',
          estimatedMinutes: 5,
          status: 'not-started' as const,
          files: [
            {
              path: 'src/foo.ts',
              oldPath: undefined,
              changeType: 'modified' as const,
              additions: 10,
              deletions: 2,
              isBinary: false,
              tier: 1 as const,
              whyHere: 'changed',
              estimatedMinutes: 3,
              riskScore: {
                level: 'low' as const,
                composite: null,
                dominantDriver: '',
                topImporters: [],
                importerCount: 0,
                metrics: {
                  changeSize: null,
                  churn90d: null,
                  blastRadius: null,
                  testFilePresent: null,
                  complexityDelta: null,
                  patchCoverage: null,
                },
              },
            },
          ],
        },
      ],
    }
  }

  it('coverageDot=pass when avgCoverage >= 80', async () => {
    const pr = makePrWithFile(null)
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
      patchCoverage: 90, // >= 80 → 'pass'
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })

    // updateQueuePrRisk was called — verify signalDots included
    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.coverage).toBe('pass')
  })

  it('coverageDot=warn when avgCoverage is 50-79', async () => {
    const pr = makePrWithFile(null)
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
      patchCoverage: 60, // >= 50 but < 80 → 'warn'
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.coverage).toBe('warn')
  })

  it('coverageDot=fail when avgCoverage < 50', async () => {
    const pr = makePrWithFile(null)
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
      patchCoverage: 30, // < 50 → 'fail'
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.coverage).toBe('fail')
  })

  it('ciDot=fail when pr.ciStatus=failing', async () => {
    const pr = makePrWithFile(null, 'failing')
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.ci).toBe('fail')
  })

  it('ciDot=warn when pr.ciStatus=pending', async () => {
    const pr = makePrWithFile(null, 'pending')
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.ci).toBe('warn')
  })

  it('ciDot=unknown when pr.ciStatus=none', async () => {
    const pr = makePrWithFile(null, 'none')
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })

    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
    const [, , signalDots] = mockUpdateQueuePrRisk.mock.calls[0]
    expect(signalDots.ci).toBe('unknown')
  })

  it('accepts prDetail argument instead of activePr', async () => {
    // useFetchFileMetrics with explicit prDetail arg (prDetail ?? activePr branch)
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: null, // no activePr
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    const prDetail = makePrWithFile(null)

    mockFileMetrics.mockResolvedValue({
      churn90d: 5,
      blastRadius: 2,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current(prDetail)
    })

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
    } as unknown as ReturnType<typeof usePrReviewStore>)

    mockPrInlineComments.mockRejectedValue(new Error('connection refused'))

    const { result } = renderHook(() => useLoadInlineComments('/repo'))
    await act(async () => {
      await result.current()
    })

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
    } as unknown as ReturnType<typeof usePrReviewStore>)
  })

  it('does nothing when repoRoot is null', async () => {
    const { result } = renderHook(() => useLoadIssueComments(null))
    await act(async () => {
      await result.current()
    })
    expect(mockPrIssueCommentsAPI).not.toHaveBeenCalled()
  })

  it('does nothing when no prNumber (no activePr and no override)', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: null,
      setIssueComments: mockSetIssueComments,
    } as unknown as ReturnType<typeof usePrReviewStore>)

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await act(async () => {
      await result.current()
    })
    expect(mockPrIssueCommentsAPI).not.toHaveBeenCalled()
  })

  it('loads comments using activePr.number when no override given', async () => {
    const comments = [
      { id: 1, author: 'alice', authorAvatarUrl: '', body: 'hi', createdAt: '', updatedAt: '' },
    ]
    mockPrIssueCommentsAPI.mockResolvedValue({ comments })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await act(async () => {
      await result.current()
    })

    expect(mockPrIssueCommentsAPI).toHaveBeenCalledWith('/repo', validActivePr.number)
    expect(mockSetIssueComments).toHaveBeenCalledWith(comments)
  })

  it('loads comments using prNumber override', async () => {
    const comments = [
      { id: 2, author: 'bob', authorAvatarUrl: '', body: 'ok', createdAt: '', updatedAt: '' },
    ]
    mockPrIssueCommentsAPI.mockResolvedValue({ comments })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await act(async () => {
      await result.current(99)
    })

    expect(mockPrIssueCommentsAPI).toHaveBeenCalledWith('/repo', 99)
    expect(mockSetIssueComments).toHaveBeenCalledWith(comments)
  })

  it('does not call setIssueComments when result contains an error', async () => {
    mockPrIssueCommentsAPI.mockResolvedValue({ error: 'NOT_AUTHENTICATED' })

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await act(async () => {
      await result.current()
    })

    expect(mockSetIssueComments).not.toHaveBeenCalled()
  })

  it('handles thrown exceptions gracefully without crashing', async () => {
    mockPrIssueCommentsAPI.mockRejectedValue(new Error('network fail'))

    const { result } = renderHook(() => useLoadIssueComments('/repo'))
    await act(async () => {
      await result.current()
    })

    expect(mockSetIssueComments).not.toHaveBeenCalled()
  })
})

describe('useFetchFileMetrics — one batched request', () => {
  const file = (path: string, tier: 1 | 2 | 3 = 1) => ({
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
      metrics: {
        changeSize: null,
        churn90d: null,
        blastRadius: null,
        testFilePresent: null,
        complexityDelta: null,
        patchCoverage: null,
      },
    },
  })

  it('asks for every non-generated file in one call and applies the scores in one update', async () => {
    const pr = {
      ...validActivePr,
      chapters: [
        {
          id: 'ch-1',
          name: 'One',
          estimatedMinutes: 1,
          status: 'not-started' as const,
          files: [file('src/a.ts'), file('src/b.ts'), file('package-lock.json', 3)],
        },
        {
          id: 'ch-2',
          name: 'Two',
          estimatedMinutes: 1,
          status: 'not-started' as const,
          files: [file('src/c.ts')],
        },
      ],
    }
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      updateFileRiskScores: mockUpdateFileRiskScores,
      updateQueuePrRisk: mockUpdateQueuePrRisk,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    mockFileMetrics.mockResolvedValue({
      churn90d: 1,
      blastRadius: 1,
      topImporters: [],
      importerCount: 0,
      testFilePresent: true,
    })

    const { result } = renderHook(() => useFetchFileMetrics('/repo'))
    await act(async () => {
      await result.current()
    })

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

describe('comment loaders — stable across activePr patches', () => {
  const setActive = (pr: typeof validActivePr | null) =>
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...vi.mocked(usePrReviewStore)(),
      activePr: pr,
      setThreads: mockSetThreads,
      setIssueComments: mockSetIssueComments,
    } as unknown as ReturnType<typeof usePrReviewStore>)

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

  it('does not fetch inline comments again when activePr is patched', async () => {
    mockPrInlineComments.mockResolvedValue({ comments: [] })
    setActive(validActivePr)
    const { rerender } = renderHook(() => {
      const load = useLoadInlineComments('/repo')
      useEffect(() => {
        void load()
      }, [load])
    })
    await act(async () => {
      await Promise.resolve()
    })
    setActive({ ...validActivePr, title: 'patched complexity' })
    rerender()
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockPrInlineComments).toHaveBeenCalledTimes(1)
  })

  it('does not fetch issue comments again when activePr is patched', async () => {
    mockPrIssueCommentsAPI.mockResolvedValue({ comments: [] })
    setActive(validActivePr)
    const { rerender } = renderHook(() => {
      const load = useLoadIssueComments('/repo')
      useEffect(() => {
        void load()
      }, [load])
    })
    await act(async () => {
      await Promise.resolve()
    })
    setActive({ ...validActivePr, title: 'patched complexity' })
    rerender()
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockPrIssueCommentsAPI).toHaveBeenCalledTimes(1)
  })
})
