import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
// Imported with the file, not inside each test: App reads the URL when it
// renders, so nothing needs a fresh module. Each view is lazy, so a test
// awaits it with findBy.
import { App } from '../../../src/renderer/App'

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

// React runs the subscribing effect after it draws the lazy view, so a test
// waits for the subscription itself, not for the view.
async function expectSubscribedToWorkspaceChanges(): Promise<(data: unknown) => void> {
  await waitFor(() =>
    expect(mockBridgeOn).toHaveBeenCalledWith('workspace:changed', expect.any(Function))
  )
  return mockBridgeOn.mock.calls.find(([channel]) => channel === 'workspace:changed')![1]
}

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

describe('git-integration renderer App', () => {
  it('passes repoRoot from URL to GitFullView', async () => {
    setSearch({ view: 'project', repoRoot: '/my/repo' })
    render(<App />)
    expect((await screen.findByTestId('git-full-view')).getAttribute('data-repo-root')).toBe(
      '/my/repo'
    )
  })

  it('renders GitFullView for ?view=project', async () => {
    setSearch({ view: 'project', repoRoot: '/my/repo' })
    render(<App />)
    expect(await screen.findByTestId('git-full-view')).toBeDefined()
  })

  it('renders PrReviewTab for ?view=code-reviews', async () => {
    setSearch({ view: 'code-reviews', repoRoot: '' })
    render(<App />)
    expect(await screen.findByTestId('pr-review-tab')).toBeDefined()
  })
})

describe('git-integration renderer App — renders PrReviewTab for ?view=pr-review', () => {
  it('renders PrReviewTab for ?view=pr-review', async () => {
    setSearch({ view: 'pr-review', repoRoot: '/my/repo' })
    render(<App />)
    expect(await screen.findByTestId('pr-review-tab')).toBeDefined()
  })

  it('subscribes to workspace:changed for live repoRoot updates', async () => {
    setSearch({ view: 'project', repoRoot: '/my/repo' })
    render(<App />)
    await expectSubscribedToWorkspaceChanges()
  })

  it('updates repoRoot when workspace:changed fires', async () => {
    setSearch({ view: 'project', repoRoot: '/initial/repo' })
    render(<App />)
    const handler = await expectSubscribedToWorkspaceChanges()
    act(() => {
      handler({ repoRoot: '/new/repo' })
    })
    expect((await screen.findByTestId('git-full-view')).getAttribute('data-repo-root')).toBe(
      '/new/repo'
    )
  })
})
