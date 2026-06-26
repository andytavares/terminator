import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('../../../src/components/GitSidebarPanel', () => ({
  GitSidebarPanel: ({ repoRoot }: { repoRoot: string | null }) => (
    <div data-testid="git-sidebar-panel" data-repo-root={repoRoot ?? ''} />
  ),
}))
vi.mock('../../../src/components/GitFullView', () => ({
  GitFullView: ({ repoRoot }: { repoRoot: string | null }) => (
    <div data-testid="git-full-view" data-repo-root={repoRoot ?? ''} />
  ),
}))
vi.mock('../../../src/components/pr-review/PrReviewTab', () => ({
  PrReviewTab: ({ repoRoot }: { repoRoot: string | null }) => (
    <div data-testid="pr-review-tab" data-repo-root={repoRoot ?? ''} />
  ),
}))

const mockBridgeOn = vi.fn()

function setSearch(params: Record<string, string>): void {
  const search = '?' + new URLSearchParams(params).toString()
  Object.defineProperty(window, 'location', {
    value: { search },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  const unsubscribe = vi.fn()
  mockBridgeOn.mockReturnValue(unsubscribe)
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { on: mockBridgeOn } },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.resetModules()
})

describe('git-integration renderer App', () => {
  it('renders GitSidebarPanel for ?view=sidebar', async () => {
    setSearch({ view: 'sidebar', repoRoot: '/my/repo' })
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('git-sidebar-panel')).toBeDefined()
    expect(screen.queryByTestId('git-full-view')).toBeNull()
  })

  it('passes repoRoot from URL to GitSidebarPanel', async () => {
    setSearch({ view: 'sidebar', repoRoot: '/my/repo' })
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    const el = screen.getByTestId('git-sidebar-panel')
    expect(el.getAttribute('data-repo-root')).toBe('/my/repo')
  })

  it('renders GitFullView for ?view=project', async () => {
    setSearch({ view: 'project', repoRoot: '/my/repo' })
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('git-full-view')).toBeDefined()
  })

  it('renders PrReviewTab for ?view=code-reviews', async () => {
    setSearch({ view: 'code-reviews', repoRoot: '' })
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('pr-review-tab')).toBeDefined()
  })

  it('renders PrReviewTab for ?view=pr-review', async () => {
    setSearch({ view: 'pr-review', repoRoot: '/my/repo' })
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('pr-review-tab')).toBeDefined()
  })

  it('subscribes to workspace:changed for live repoRoot updates', async () => {
    setSearch({ view: 'sidebar', repoRoot: '/my/repo' })
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(mockBridgeOn).toHaveBeenCalledWith('workspace:changed', expect.any(Function))
  })

  it('updates repoRoot when workspace:changed fires', async () => {
    setSearch({ view: 'sidebar', repoRoot: '/initial/repo' })
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    const handler = mockBridgeOn.mock.calls.find(([ch]) => ch === 'workspace:changed')?.[1]
    act(() => {
      handler?.({ repoRoot: '/new/repo' })
    })
    const el = screen.getByTestId('git-sidebar-panel')
    expect(el.getAttribute('data-repo-root')).toBe('/new/repo')
  })
})
