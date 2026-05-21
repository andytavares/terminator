import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { ExtensionWindowView } from '../../../src/renderer/ExtensionWindowView'

vi.mock('../../../src/renderer/stores/settings.store', () => ({ useSettingsStore: vi.fn() }))
vi.mock('../../../src/renderer/extensions/registry', () => ({ useExtensionRegistry: vi.fn() }))
vi.mock('../../../src/renderer/components/ToastContainer', () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
}))
vi.mock('../../../src/renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockLoadSettings = vi.fn()

function setupMocks(windowViews = new Map()) {
  vi.mocked(useSettingsStore).mockReturnValue({
    loadSettings: mockLoadSettings,
    resolvedTheme: 'dark',
  } as unknown as ReturnType<typeof useSettingsStore>)
  vi.mocked(useExtensionRegistry).mockReturnValue(
    windowViews as unknown as ReturnType<typeof useExtensionRegistry>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setupMocks()
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: { search: '' },
    writable: true,
  })
})

describe('ExtensionWindowView', () => {
  it('renders ToastContainer', () => {
    setupMocks()
    render(<ExtensionWindowView view="pr-review" />)
    expect(screen.getByTestId('toast-container')).toBeTruthy()
  })

  it('shows "not found" message when view is not registered', () => {
    setupMocks(new Map())
    render(<ExtensionWindowView view="unknown-view" />)
    expect(screen.getByText('Extension view not found: unknown-view')).toBeTruthy()
  })

  it('renders the registered view component', () => {
    const FakeView = ({ repoRoot }: { repoRoot: string | null }) => (
      <div data-testid="fake-view" data-repo-root={repoRoot ?? ''} />
    )
    const views = new Map([['pr-review', FakeView]])
    setupMocks(views)
    Object.defineProperty(window, 'location', {
      value: { search: '?repoRoot=/home/user/myrepo' },
      writable: true,
    })
    render(<ExtensionWindowView view="pr-review" />)
    expect(screen.getByTestId('fake-view').getAttribute('data-repo-root')).toBe('/home/user/myrepo')
  })

  it('renders accent bar when accentColor param is present', () => {
    setupMocks()
    Object.defineProperty(window, 'location', {
      value: { search: '?accentColor=%23ff0000' },
      writable: true,
    })
    const { container } = render(<ExtensionWindowView view="pr-review" />)
    const accentBar = container.querySelector('div[style*="height: 3px"]')
    expect(accentBar).toBeTruthy()
  })

  it('does not render accent bar when accentColor param is absent', () => {
    setupMocks()
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    })
    const { container } = render(<ExtensionWindowView view="pr-review" />)
    const accentBar = container.querySelector('div[style*="height: 3px"]')
    expect(accentBar).toBeFalsy()
  })

  it('calls loadSettings on mount', () => {
    setupMocks()
    render(<ExtensionWindowView view="pr-review" />)
    expect(mockLoadSettings).toHaveBeenCalledTimes(1)
  })

  it('sets data-theme attribute from resolvedTheme', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      loadSettings: mockLoadSettings,
      resolvedTheme: 'light',
    } as unknown as ReturnType<typeof useSettingsStore>)
    vi.mocked(useExtensionRegistry).mockReturnValue(
      new Map() as unknown as ReturnType<typeof useExtensionRegistry>
    )
    render(<ExtensionWindowView view="pr-review" />)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
