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
  vi.stubGlobal('location', { search })
}

beforeEach(() => {
  vi.clearAllMocks()
  const unsubscribe = vi.fn()
  mockBridgeOn.mockReturnValue(unsubscribe)
  vi.stubGlobal('electronAPI', { extensionBridge: { on: mockBridgeOn } })
})

describe('git-integration renderer App', () => {
  it('passes repoRoot from URL to GitFullView', async () => {
    setSearch({ view: 'project', repoRoot: '/my/repo' })
    render(<App />)
    expect((await screen.findByTestId('git-full-view')).getAttribute('data-repo-root')).toBe(
      '/my/repo'
    )
  })

  it.each([
    { view: 'code-reviews', repoRoot: '' },
    { view: 'pr-review', repoRoot: '/my/repo' },
  ])('renders PrReviewTab with repoRoot $repoRoot for ?view=$view', async ({ view, repoRoot }) => {
    setSearch({ view, repoRoot })
    render(<App />)
    expect((await screen.findByTestId('pr-review-tab')).getAttribute('data-repo-root')).toBe(
      repoRoot
    )
  })
})

describe('git-integration renderer App — live repoRoot', () => {
  it('keeps the repoRoot its URL names when workspace:changed fires', async () => {
    setSearch({ view: 'pr-review', repoRoot: '/review/repo', prNumber: '3' })
    render(<App />)
    const handler = await expectSubscribedToWorkspaceChanges()
    act(() => {
      handler({ repoRoot: '/other/repo' })
    })
    expect((await screen.findByTestId('pr-review-tab')).getAttribute('data-repo-root')).toBe(
      '/review/repo'
    )
  })

  it('follows workspace:changed when its URL names no repoRoot', async () => {
    setSearch({ view: 'project', repoRoot: '' })
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
