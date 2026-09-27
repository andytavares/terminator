import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAgentRuns } from '../../src/hooks/useAgentRuns'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'
import type { AgentRun } from '../../src/schemas/review-agent.schema'

const mockList = vi.fn()
const mockOnEvent = vi.fn()
const mockUnsubscribe = vi.fn()

vi.mock('../../src/api/review-agent', () => ({
  reviewAgentAPI: {
    list: (...args: unknown[]) => mockList(...args),
    onEvent: (...args: unknown[]) => mockOnEvent(...args),
  },
}))

const mockSetAgentRuns = vi.fn()
const mockUpsertAgentRun = vi.fn()

vi.mock('../../src/stores/review-ui.store', () => ({
  useReviewUiStore: {
    getState: () => ({
      setAgentRuns: mockSetAgentRuns,
      upsertAgentRun: mockUpsertAgentRun,
    }),
  },
}))

function makePr(overrides: Partial<PrReviewDetail> = {}): PrReviewDetail {
  return {
    number: 42,
    title: 'Test PR',
    body: '',
    author: 'octocat',
    authorAvatarUrl: '',
    openedAt: new Date().toISOString(),
    headRefName: 'feature',
    baseRefName: 'main',
    headSHA: 'abc123',
    isDraft: false,
    mergeStateStatus: 'clean',
    ciStatus: 'passing',
    lintStatus: 'unknown',
    coverageStatus: 'unknown',
    statusChecks: [],
    approvals: [],
    requestedReviewers: [],
    assigneeLogins: [],
    chapters: [],
    issueRefs: [],
    dryViolations: [],
    readingOrder: [],
    movedBlocks: [],
    insights: null,
    ...overrides,
  }
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    repoRoot: '/repo',
    prNumber: 42,
    headSHA: 'abc123',
    sessionId: 'sess-1',
    scope: {
      kind: 'lines',
      path: 'extensions/git-integration/src/hooks/usePrReview.ts',
      startLine: 309,
      endLine: 317,
      side: 'RIGHT',
      chapter: null,
    },
    request: 'review',
    question: null,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    activity: [],
    summary: null,
    findings: [],
    walkthrough: [],
    error: null,
    ...overrides,
  }
}

let listedRun: AgentRun

beforeEach(() => {
  vi.clearAllMocks()
  listedRun = makeRun()
  mockList.mockResolvedValue({ runs: [listedRun] })
  mockOnEvent.mockReturnValue(mockUnsubscribe)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAgentRuns', () => {
  it('loads runs for the repo/pr/headSHA on mount and stores them', async () => {
    const pr = makePr()
    renderHook(() => useAgentRuns('/repo', pr))

    await vi.waitFor(() => {
      expect(mockList).toHaveBeenCalledWith('/repo', 42, 'abc123')
    })
    await vi.waitFor(() => {
      expect(mockSetAgentRuns).toHaveBeenCalledWith([listedRun])
    })
  })

  it('applies events only for this pr', () => {
    const pr = makePr()
    renderHook(() => useAgentRuns('/repo', pr))

    expect(mockOnEvent).toHaveBeenCalledTimes(1)
    const handler = mockOnEvent.mock.calls[0][0] as (payload: { run: AgentRun }) => void

    const matching = makeRun({ id: 'run-2' })
    handler({ run: matching })
    expect(mockUpsertAgentRun).toHaveBeenCalledWith(matching)

    mockUpsertAgentRun.mockClear()
    const otherPr = makeRun({ id: 'run-3', prNumber: 999 })
    handler({ run: otherPr })
    expect(mockUpsertAgentRun).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    const pr = makePr()
    const { unmount } = renderHook(() => useAgentRuns('/repo', pr))
    expect(mockUnsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })
})
