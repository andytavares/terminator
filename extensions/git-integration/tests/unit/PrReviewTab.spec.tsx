import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrReviewTab } from '../../src/components/pr-review/PrReviewTab'
import { usePrReviewStore } from '../../src/stores/pr-review.store'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

vi.mock('../../src/hooks/usePrReview', () => ({
  useLoadPrQueue: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useLoadPrDetail: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useFetchFileMetrics: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
}))

vi.mock('../../src/components/pr-review/ReviewQueue', () => ({
  ReviewQueue: ({ onOpenPr, onRefresh, onLoadMore, onToggleClosedPrs }: any) => (
    <div data-testid="review-queue">
      <button onClick={() => onOpenPr({ number: 1, title: 'Test PR' })}>Open PR</button>
      <button onClick={() => onRefresh({ search: 'test' })}>Refresh</button>
      <button onClick={() => onLoadMore()}>Load More</button>
      <button onClick={() => onToggleClosedPrs(true)}>Toggle Closed</button>
    </div>
  ),
}))

vi.mock('../../src/components/pr-review/PrReviewView', () => ({
  PrReviewView: ({ onClose, onRefresh }: any) => (
    <div data-testid="pr-review-view">
      <button onClick={onClose}>Close PR</button>
      <button onClick={onRefresh}>Refresh PR</button>
    </div>
  ),
}))

const mockSetActivePr = vi.fn()
const mockSetIncludeClosedPrs = vi.fn()
const mockInitSession = vi.fn()
const mockReset = vi.fn()

const defaultStoreState = {
  activePr: null,
  setActivePr: mockSetActivePr,
  initSession: mockInitSession,
  reset: mockReset,
  nextPrCursor: null,
  includeClosedPrs: false,
  setIncludeClosedPrs: mockSetIncludeClosedPrs,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).electronAPI = {
    github: { sessionGet: vi.fn().mockResolvedValue({ session: null }) },
    window: { openPrReview: vi.fn() },
  }
  vi.mocked(usePrReviewStore).mockReturnValue(defaultStoreState as any)
})

afterEach(() => {
  delete (globalThis as any).electronAPI
})

describe('PrReviewTab', () => {
  it('shows empty message when repoRoot is null', () => {
    render(<PrReviewTab repoRoot={null} />)
    expect(screen.getByText('Open a project to view pull requests.')).toBeTruthy()
  })

  it('renders ReviewQueue when repoRoot is provided', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    expect(screen.getByTestId('review-queue')).toBeTruthy()
  })

  it('renders PrReviewView when activePr is set', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: { number: 1, title: 'My PR' } as any,
    } as any)
    render(<PrReviewTab repoRoot="/repo" />)
    expect(screen.getByTestId('pr-review-view')).toBeTruthy()
  })

  it('shows pop out button', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    expect(screen.getByTitle('Open in new window')).toBeTruthy()
  })

  it('calls openPrReview when pop out button is clicked', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByTitle('Open in new window'))
    expect((globalThis as any).electronAPI.window.openPrReview).toHaveBeenCalledWith('/repo')
  })

  it('closes PR view when onClose is called', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: { number: 1, title: 'My PR' } as any,
    } as any)
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
