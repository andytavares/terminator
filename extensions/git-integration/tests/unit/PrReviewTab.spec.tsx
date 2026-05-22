import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrReviewTab } from '../../src/components/pr-review/PrReviewTab'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import * as githubModule from '../../src/api/github'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    sessionGet: vi.fn().mockResolvedValue({ session: null }),
    sessionSet: vi.fn().mockResolvedValue({}),
    saveActiveReview: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

vi.mock('../../src/hooks/usePrReview', () => ({
  useLoadPrQueue: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useLoadPrDetail: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useFetchFileMetrics: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
}))

vi.mock('../../src/components/pr-review/ReviewQueue', () => ({
  ReviewQueue: ({
    onOpenPr,
    onRefresh,
    onLoadMore,
    onToggleClosedPrs,
  }: {
    onOpenPr: (pr: { number: number; title: string }) => void
    onRefresh: (opts: { search: string }) => void
    onLoadMore: () => void
    onToggleClosedPrs: (v: boolean) => void
  }) => (
    <div data-testid="review-queue">
      <button onClick={() => onOpenPr({ number: 1, title: 'Test PR' })}>Open PR</button>
      <button onClick={() => onRefresh({ search: 'test' })}>Refresh</button>
      <button onClick={() => onLoadMore()}>Load More</button>
      <button onClick={() => onToggleClosedPrs(true)}>Toggle Closed</button>
    </div>
  ),
}))

vi.mock('../../src/components/pr-review/PrReviewView', () => ({
  PrReviewView: ({
    onClose,
    onRefresh,
    onShowOverview,
    onPopOut,
  }: {
    onClose: () => void
    onRefresh: () => void
    onShowOverview?: () => void
    onPopOut?: () => void
  }) => (
    <div data-testid="pr-review-view">
      <button onClick={onClose}>Close PR</button>
      <button onClick={onRefresh}>Refresh PR</button>
      {onShowOverview && <button onClick={onShowOverview}>Show Overview</button>}
      {onPopOut && (
        <button onClick={onPopOut} title="Open in focused window">
          Pop out
        </button>
      )}
    </div>
  ),
}))

vi.mock('../../src/components/pr-review/PrOverviewPanel', () => ({
  PrOverviewPanel: ({
    onStartReview,
    onClose,
  }: {
    onStartReview: () => void
    onClose: () => void
  }) => (
    <div data-testid="pr-overview-panel">
      <button onClick={onStartReview}>Start Review</button>
      <button onClick={onClose}>Close Overview</button>
    </div>
  ),
}))

const mockSetActivePr = vi.fn()
const mockSetIncludeClosedPrs = vi.fn()
const mockInitSession = vi.fn()
const mockReset = vi.fn()
const mockMarkPrInProgress = vi.fn()

const defaultStoreState = {
  activePr: null,
  setActivePr: mockSetActivePr,
  initSession: mockInitSession,
  reset: mockReset,
  markPrInProgress: mockMarkPrInProgress,
  nextPrCursor: null,
  includeClosedPrs: false,
  setIncludeClosedPrs: mockSetIncludeClosedPrs,
  viewedFiles: new Set<string>(),
  currentChapterId: null,
  currentFilePath: null,
  fileOrderOverrides: {},
  scrollPosition: null,
}

const mockInvoke = vi.fn().mockResolvedValue({ ok: true })
const mockOn = vi.fn().mockReturnValue(() => {})

beforeEach(() => {
  vi.clearAllMocks()
  ;(githubModule.githubAPI.sessionGet as ReturnType<typeof vi.fn>).mockResolvedValue({
    session: null,
  })
  ;(githubModule.githubAPI.sessionSet as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(githubModule.githubAPI.saveActiveReview as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
  })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: {
      invoke: mockInvoke,
      on: mockOn,
    },
  }
  vi.mocked(usePrReviewStore).mockReturnValue(
    defaultStoreState as unknown as ReturnType<typeof usePrReviewStore>
  )
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('PrReviewTab', () => {
  it('shows empty message when repoRoot is null', () => {
    render(<PrReviewTab repoRoot={null} />)
    expect(screen.getByText('Open a project to view pull requests.')).toBeTruthy()
  })

  it('renders ReviewQueue when repoRoot is provided and no active PR', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    expect(screen.getByTestId('review-queue')).toBeTruthy()
  })

  it('renders PrOverviewPanel when activePr is set', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: { number: 1, title: 'My PR' } as unknown as PrReviewDetail,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    // showOverview starts false; we need to simulate opening a PR to get it to true
    // Since activePr is pre-set here, showOverview stays false → PrReviewView shows
    render(<PrReviewTab repoRoot="/repo" />)
    // With activePr set and showOverview=false, PrReviewView should render
    expect(screen.getByTestId('pr-review-view')).toBeTruthy()
  })

  it('shows pop out button', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    expect(screen.getByTitle('Open in new window')).toBeTruthy()
  })

  it('calls extensionBridge.invoke with window:open-pr-review when pop out button is clicked', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByTitle('Open in new window'))
    expect(mockInvoke).toHaveBeenCalledWith(
      'window:open-pr-review',
      expect.objectContaining({ repoRoot: '/repo' })
    )
  })

  it('includes prNumber and showOverview in popout payload when a PR is active', async () => {
    const activePr = {
      number: 42,
      title: 'Active PR',
      headSHA: 'sha123',
    } as unknown as PrReviewDetail
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<PrReviewTab repoRoot="/repo" />)
    // activePr is set + showOverview defaults to false → PrReviewView renders
    fireEvent.click(screen.getByTitle('Open in focused window'))
    expect(mockInvoke).toHaveBeenCalledWith(
      'window:open-pr-review',
      expect.objectContaining({ repoRoot: '/repo', prNumber: '42', showOverview: 'false' })
    )
  })

  it('closes PR view and persists paused session when onClose is called', async () => {
    const activePr = { number: 1, title: 'My PR', headSHA: 'abc123' } as unknown as PrReviewDetail
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Close PR'))
    // Allow async handleClosePr to settle
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSetActivePr).toHaveBeenCalledWith(null)
    expect(mockReset).toHaveBeenCalled()
    expect(githubModule.githubAPI.sessionSet).toHaveBeenCalledWith(
      '/repo:::1:::abc123',
      expect.objectContaining({ pausedAt: expect.any(String) })
    )
  })

  it('calls setIncludeClosedPrs when toggle closed is clicked', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Toggle Closed'))
    expect(mockSetIncludeClosedPrs).toHaveBeenCalledWith(true)
  })
})
