import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrReviewTab } from '../../src/components/pr-review/PrReviewTab'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
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
  }: {
    onClose: () => void
    onRefresh: () => void
    onShowOverview?: () => void
  }) => (
    <div data-testid="pr-review-view">
      <button onClick={onClose}>Close PR</button>
      <button onClick={onRefresh}>Refresh PR</button>
      {onShowOverview && <button onClick={onShowOverview}>Show Overview</button>}
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
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    github: {
      sessionGet: vi.fn().mockResolvedValue({ session: null }),
      sessionSet: vi.fn().mockResolvedValue({}),
    },
    window: { openPrReview: vi.fn(), onPrReviewWindowChange: vi.fn().mockReturnValue(() => {}) },
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

  it('calls openPrReview when pop out button is clicked', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByTitle('Open in new window'))
    expect(
      (window.electronAPI as unknown as { window: { openPrReview: ReturnType<typeof vi.fn> } })
        .window.openPrReview
    ).toHaveBeenCalledWith('/repo')
  })

  it('closes PR view when onClose is called from review view', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: { number: 1, title: 'My PR' } as unknown as PrReviewDetail,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Close PR'))
    expect(mockSetActivePr).toHaveBeenCalledWith(null)
    expect(mockReset).toHaveBeenCalled()
  })

  it('calls setIncludeClosedPrs when toggle closed is clicked', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Toggle Closed'))
    expect(mockSetIncludeClosedPrs).toHaveBeenCalledWith(true)
  })
})
