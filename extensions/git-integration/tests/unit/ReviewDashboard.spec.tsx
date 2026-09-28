import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ReviewDashboard } from '../../src/components/pr-review/ReviewDashboard'
import type { DashboardPR } from '../../src/schemas/pr-review.schema'

function makePr(overrides: Partial<DashboardPR> = {}): DashboardPR {
  return {
    repo: 'andytavares/terminator',
    localRepoRoot: '/repo/terminator',
    section: 'requested',
    number: 1,
    title: 'Sample PR',
    url: 'https://github.com/andytavares/terminator/pull/1',
    author: 'alice',
    isDraft: false,
    createdAt: new Date().toISOString(),
    additions: 10,
    deletions: 5,
    fileCount: 2,
    riskLevel: 'low',
    estimatedMinutes: 5,
    ciStatus: 'passing',
    reviewDecision: 'review-required',
    unresolvedThreads: 0,
    commitsSinceMyReview: 0,
    reviewerCount: 1,
    ...overrides,
  }
}

const pr211 = makePr({
  repo: 'andytavares/terminator',
  section: 're-review',
  number: 211,
  title: 'E2E: deterministic, faster, and only the specs a diff needs',
  additions: 4043,
  deletions: 2103,
  fileCount: 56,
  riskLevel: 'high',
  estimatedMinutes: 18,
  reviewDecision: 'review-required',
  commitsSinceMyReview: 3,
  reviewerCount: 2,
  createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
})

const pr210 = makePr({
  repo: 'andytavares/terminator',
  section: 'requested',
  number: 210,
  title: 'Foundry: the red team argues before agreement',
  additions: 3699,
  deletions: 402,
  fileCount: 49,
  riskLevel: 'high',
  estimatedMinutes: 72,
  reviewDecision: 'review-required',
  reviewerCount: 2,
  createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
})

const pr212 = makePr({
  repo: 'andytavares/terminator',
  section: 'team',
  number: 212,
  title: 'ci: split the E2E burn-in across both shards',
  additions: 3,
  deletions: 3,
  fileCount: 1,
  riskLevel: 'low',
  estimatedMinutes: 1,
  reviewDecision: 'review-required',
  reviewerCount: 1,
  createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
})

const pr213 = makePr({
  repo: 'andytavares/terminator',
  localRepoRoot: null,
  section: 'mine',
  number: 213,
  title: 'Deterministic, faster CI: no Electron download in unit tests',
  additions: 1385,
  deletions: 246,
  fileCount: 109,
  riskLevel: 'medium',
  estimatedMinutes: 20,
  ciStatus: 'passing',
  reviewDecision: 'changes-requested',
  unresolvedThreads: 2,
  createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
})

function mockInvoke(
  dashboardResult: unknown,
  options: { cloneFolder?: string; cloneResult?: unknown; cloneError?: Error } = {}
) {
  const invoke = vi.fn((channel: string) => {
    if (channel === 'github:dashboard-search') return Promise.resolve(dashboardResult)
    if (channel === 'github:review-settings')
      return Promise.resolve({ cloneFolder: options.cloneFolder ?? '' })
    if (channel === 'github:clone-repo') {
      if (options.cloneError) return Promise.reject(options.cloneError)
      return Promise.resolve(options.cloneResult ?? { repoRoot: '/cloned/terminator' })
    }
    return Promise.resolve({})
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: {
      invoke,
      on: vi.fn(() => () => {}),
    },
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReviewDashboard', () => {
  it('renders the three tabs with counts', async () => {
    mockInvoke({
      prs: [pr211, pr210, pr212, pr213],
      login: 'andytavares',
      fetchedAt: new Date().toISOString(),
    })
    render(<ReviewDashboard />)
    // The tab list renders while loading with zero counts; wait for the data.
    await waitFor(() => within(screen.getByRole('tablist')).getByText('3'))
    const tablist = screen.getByRole('tablist')
    expect(within(tablist).getByText('3')).toBeTruthy() // needs you: 211,210,212
    expect(within(tablist).getByText('1')).toBeTruthy() // mine: 213
    expect(screen.getByRole('tab', { name: /Needs you/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /My PRs/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Involved/ })).toBeTruthy()
  })

  it('renders groups in order with correct headings and row content', async () => {
    mockInvoke({
      prs: [pr211, pr210, pr212],
      login: 'andytavares',
      fetchedAt: new Date().toISOString(),
    })
    render(<ReviewDashboard />)
    const headings = await screen.findAllByText(/RE-REVIEW|REQUESTED OF YOU|REQUESTED OF YOUR TEAM/)
    expect(headings.map((h) => h.textContent)).toEqual([
      'RE-REVIEW · NEW COMMITS SINCE YOU REVIEWED',
      'REQUESTED OF YOU',
      'REQUESTED OF YOUR TEAM',
    ])
    const size = screen.getByText('+4,043').closest('.rd-size')!
    expect(size.textContent).toBe('+4,043 −2,103 · 56 files')
    expect(screen.getByText('+4,043').className).toBe('rd-add')
    expect(screen.getByText('−2,103').className).toBe('rd-del')
    expect(screen.getAllByText('High risk').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Re-review' })).toBeTruthy()
  })

  it('omits an empty group', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByText('REQUESTED OF YOU')
    expect(screen.queryByText(/RE-REVIEW/)).toBeNull()
    expect(screen.queryByText('REQUESTED OF YOUR TEAM')).toBeNull()
  })

  it('switches to My PRs tab and shows its rows', async () => {
    mockInvoke({ prs: [pr211, pr213], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByText('RE-REVIEW · NEW COMMITS SINCE YOU REVIEWED')
    fireEvent.click(screen.getByRole('tab', { name: /My PRs/ }))
    await screen.findByText('YOUR OPEN PRS')
    expect(screen.getByText('+1,385').closest('.rd-size')!.textContent).toBe(
      '+1,385 −246 · 109 files'
    )
    expect(screen.getByText('Changes asked')).toBeTruthy()
  })

  it('keeps the "Open" label and notes "Not cloned" when localRepoRoot is null', async () => {
    mockInvoke({ prs: [pr213], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    fireEvent.click(screen.getByRole('tab', { name: /My PRs/ }))
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy()
    expect(screen.getByText(/Not cloned.*diff only/)).toBeTruthy()
  })

  it('invokes window:open-pr-review with the right payload on row click', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    const btn = await screen.findByRole('button', { name: 'Review' })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(window.electronAPI.extensionBridge.invoke).toHaveBeenCalledWith(
        'window:open-pr-review',
        { repoRoot: '/repo/terminator', prNumber: '210', showOverview: 'true' }
      )
    })
  })

  it('opens an uncloned row via the gh: pseudo repo root', async () => {
    mockInvoke({ prs: [pr213], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    fireEvent.click(screen.getByRole('tab', { name: /My PRs/ }))
    const btn = await screen.findByRole('button', { name: 'Open' })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(window.electronAPI.extensionBridge.invoke).toHaveBeenCalledWith(
        'window:open-pr-review',
        { repoRoot: 'gh:andytavares/terminator', prNumber: '213', showOverview: 'true' }
      )
    })
  })

  it('shows "Clone and review" only when a clone folder is configured, and clones then opens', async () => {
    mockInvoke(
      { prs: [pr213], login: 'andytavares', fetchedAt: new Date().toISOString() },
      { cloneFolder: '/Users/me/repos', cloneResult: { repoRoot: '/Users/me/repos/terminator' } }
    )
    render(<ReviewDashboard />)
    fireEvent.click(screen.getByRole('tab', { name: /My PRs/ }))
    const cloneBtn = await screen.findByRole('button', { name: 'Clone and review' })
    fireEvent.click(cloneBtn)
    await waitFor(() => {
      expect(window.electronAPI.extensionBridge.invoke).toHaveBeenCalledWith('github:clone-repo', {
        repo: 'andytavares/terminator',
        folder: '/Users/me/repos',
      })
    })
    await waitFor(() => {
      expect(window.electronAPI.extensionBridge.invoke).toHaveBeenCalledWith(
        'window:open-pr-review',
        { repoRoot: '/Users/me/repos/terminator', prNumber: '213', showOverview: 'true' }
      )
    })
  })

  it('does not show "Clone and review" when no clone folder is configured', async () => {
    mockInvoke(
      { prs: [pr213], login: 'andytavares', fetchedAt: new Date().toISOString() },
      { cloneFolder: '' }
    )
    render(<ReviewDashboard />)
    fireEvent.click(screen.getByRole('tab', { name: /My PRs/ }))
    await screen.findByRole('button', { name: 'Open' })
    expect(screen.queryByRole('button', { name: 'Clone and review' })).toBeNull()
  })

  it('shows an error state with Retry', async () => {
    mockInvoke({ error: 'network down' })
    render(<ReviewDashboard />)
    expect(await screen.findByText(/network down/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
