import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { ExtensionWindowView } from '../../../src/renderer/ExtensionWindowView'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../src/shared/schemas/settings.schema'
import type { GlobalSettings } from '../../../src/shared/types/index'
import { resetStore } from '../../support/renderer-stores'
import { installElectronApi } from '../../support/electron-api'

vi.mock('../../../src/renderer/components/ToastContainer', () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
}))
vi.mock('../../../src/renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

/** The window's settings, as main answers `settings.getGlobal`. */
function savedSettings(theme: GlobalSettings['appearance']['theme']): void {
  const settings: GlobalSettings = { ...DEFAULT_GLOBAL_SETTINGS, appearance: { theme } }
  installElectronApi({ settings: { getGlobal: async () => ({ settings }) } })
}

function openedWith(search: string): void {
  Object.defineProperty(window, 'location', { value: { search }, writable: true })
}

beforeEach(() => {
  resetStore(useSettingsStore)
  resetStore(useExtensionRegistry)
  savedSettings('dark')
})

afterEach(() => openedWith(''))

describe('ExtensionWindowView', () => {
  it('renders ToastContainer', () => {
    render(<ExtensionWindowView view="pr-review" />)
    expect(screen.getByTestId('toast-container')).toBeTruthy()
  })

  it('shows "not found" message when view is not registered', () => {
    render(<ExtensionWindowView view="unknown-view" />)
    expect(screen.getByText('Extension view not found: unknown-view')).toBeTruthy()
  })

  it('renders the registered view component', () => {
    const FakeView = ({ repoRoot }: { repoRoot: string | null }) => (
      <div data-testid="fake-view" data-repo-root={repoRoot ?? ''} />
    )
    useExtensionRegistry.getState().registerWindowView('pr-review', FakeView)
    openedWith('?repoRoot=/home/user/myrepo')
    render(<ExtensionWindowView view="pr-review" />)
    expect(screen.getByTestId('fake-view').getAttribute('data-repo-root')).toBe('/home/user/myrepo')
  })

  it('renders accent bar when accentColor param is present', () => {
    openedWith('?accentColor=%23ff0000')
    const { container } = render(<ExtensionWindowView view="pr-review" />)
    expect(container.querySelector('div[style*="height: 3px"]')).toBeTruthy()
  })

  it('does not render accent bar when accentColor param is absent', () => {
    openedWith('')
    const { container } = render(<ExtensionWindowView view="pr-review" />)
    expect(container.querySelector('div[style*="height: 3px"]')).toBeFalsy()
  })

  it('takes the theme from the saved settings it loads on mount', async () => {
    savedSettings('light')
    render(<ExtensionWindowView view="pr-review" />)
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
  })
})
