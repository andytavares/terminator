import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { PrReviewWindow } from '../../../src/renderer/PrReviewWindow'

vi.mock('../../../src/renderer/stores/settings.store', () => ({ useSettingsStore: vi.fn() }))

vi.mock('../../../extensions/git-integration/src/components/pr-review/PrReviewTab', () => ({
  PrReviewTab: ({ repoRoot }: { repoRoot: string | null }) => (
    <div data-testid="pr-review-tab" data-repo-root={repoRoot ?? ''} />
  ),
}))
vi.mock('../../../src/renderer/components/ToastContainer', () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
}))
vi.mock('../../../src/renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockLoadSettings = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSettingsStore).mockReturnValue({
    loadSettings: mockLoadSettings,
    resolvedTheme: 'dark',
  } as unknown as ReturnType<typeof useSettingsStore>)
})

afterEach(() => {
  // Reset location search
  Object.defineProperty(window, 'location', {
    value: { search: '' },
    writable: true,
  })
})

describe('PrReviewWindow', () => {
  it('renders PrReviewTab and ToastContainer', () => {
    render(<PrReviewWindow />)
    expect(screen.getByTestId('pr-review-tab')).toBeTruthy()
    expect(screen.getByTestId('toast-container')).toBeTruthy()
  })

  it('passes repoRoot from URL params to PrReviewTab', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?repoRoot=/home/user/myrepo' },
      writable: true,
    })
    render(<PrReviewWindow />)
    expect(screen.getByTestId('pr-review-tab').getAttribute('data-repo-root')).toBe(
      '/home/user/myrepo'
    )
  })

  it('passes null repoRoot when not in URL params', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    })
    render(<PrReviewWindow />)
    expect(screen.getByTestId('pr-review-tab').getAttribute('data-repo-root')).toBe('')
  })

  it('renders accent bar when accentColor param is present', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?accentColor=%23ff0000' },
      writable: true,
    })
    const { container } = render(<PrReviewWindow />)
    const accentBar = container.querySelector('div[style*="height: 3px"]')
    expect(accentBar).toBeTruthy()
  })

  it('does not render accent bar when accentColor param is absent', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    })
    const { container } = render(<PrReviewWindow />)
    const accentBar = container.querySelector('div[style*="height: 3px"]')
    expect(accentBar).toBeFalsy()
  })

  it('calls loadSettings on mount', () => {
    render(<PrReviewWindow />)
    expect(mockLoadSettings).toHaveBeenCalledTimes(1)
  })

  it('sets data-theme attribute from resolvedTheme', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      loadSettings: mockLoadSettings,
      resolvedTheme: 'light',
    } as unknown as ReturnType<typeof useSettingsStore>)
    render(<PrReviewWindow />)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
