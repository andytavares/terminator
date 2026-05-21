import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import {
  useLoadPrQueue,
  useLoadPrDetail,
  useFetchFileMetrics,
  useLoadInlineComments,
} from '../../src/hooks/usePrReview'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

const mockListOpenPrsAPI = vi.fn()
const mockPrReviewDetailAPI = vi.fn()
const mockFileMetricsAPI = vi.fn()
const mockPrInlineCommentsAPI = vi.fn()
const mockSessionsForRepoAPI = vi.fn().mockResolvedValue({ sessions: [] })
const mockActiveReviewsForRepoAPI = vi.fn().mockResolvedValue({ error: 'NOT_FOUND' })

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    listOpenPrs: (...args: unknown[]) => mockListOpenPrsAPI(...args),
    prReviewDetail: (...args: unknown[]) => mockPrReviewDetailAPI(...args),
    fileMetrics: (...args: unknown[]) => mockFileMetricsAPI(...args),
    prInlineComments: (...args: unknown[]) => mockPrInlineCommentsAPI(...args),
    sessionsForRepo: (...args: unknown[]) => mockSessionsForRepoAPI(...args),
    activeReviewsForRepo: (...args: unknown[]) => mockActiveReviewsForRepoAPI(...args),
  },
}))

vi.mock('../../src/github/pr-review-service', () => ({
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
}))

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
const mockUpdateFileRiskScore = vi.fn()
const mockUpdateQueuePrRisk = vi.fn()

// Aliases so existing test assertions still work without changes
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
    updateFileRiskScore: mockUpdateFileRiskScore,
    updateQueuePrRisk: mockUpdateQueuePrRisk,
    includeClosedPrs: false,
    activePr: null,
  } as unknown as ReturnType<typeof usePrReviewStore>)
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
      updateFileRiskScore: mockUpdateFileRiskScore,
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
    expect(mockUpdateFileRiskScore).toHaveBeenCalled()
    expect(mockUpdateQueuePrRisk).toHaveBeenCalled()
  })
})
