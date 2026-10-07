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
  options: {
    cloneFolder?: string
    cloneResult?: unknown
    cloneError?: Error
    repos?: string[]
  } = {}
) {
  const invoke = vi.fn((channel: string) => {
    if (channel === 'github:dashboard-search') return Promise.resolve(dashboardResult)
    if (channel === 'github:review-settings')
      return Promise.resolve({ cloneFolder: options.cloneFolder ?? '', repos: options.repos ?? [] })
    if (channel === 'github:accessible-repos')
      return Promise.resolve({
        repos: [
          {
            fullName: 'acme/api',
            owner: 'acme',
            private: false,
            pushedAt: new Date().toISOString(),
          },
          {
            fullName: 'acme/web',
            owner: 'acme',
            private: true,
            pushedAt: new Date().toISOString(),
          },
        ],
      })
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
  it('says how long ago a pull request opened in words', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    expect(await screen.findByText(/opened 3 days ago/)).toBeTruthy()
  })

  it('reloads when a review is submitted elsewhere', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    const bridge = (
      window as unknown as {
        electronAPI: {
          extensionBridge: { invoke: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
        }
      }
    ).electronAPI.extensionBridge
    const listeners: Record<string, () => void> = {}
    bridge.on.mockImplementation((channel: string, cb: () => void) => {
      listeners[channel] = cb
      return () => {}
    })
    render(<ReviewDashboard />)
    await screen.findByText('REQUESTED OF YOU')
    bridge.invoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'github:dashboard-search'
          ? { prs: [], login: 'andytavares', fetchedAt: new Date().toISOString() }
          : {}
      )
    )
    listeners['reviews:changed']()
    await screen.findByText('Nothing needs you')
  })

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

  it('puts the reviews requested of you above every other group', async () => {
    mockInvoke({
      prs: [pr211, pr210, pr212],
      login: 'andytavares',
      fetchedAt: new Date().toISOString(),
    })
    render(<ReviewDashboard />)
    const headings = await screen.findAllByText(/RE-REVIEW|REQUESTED OF YOU|REQUESTED OF YOUR TEAM/)
    expect(headings.map((h) => h.textContent)).toEqual([
      'REQUESTED OF YOU',
      'RE-REVIEW · NEW COMMITS SINCE YOU REVIEWED',
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
  it('labels the scope button from the saved selection', async () => {
    mockInvoke(
      { prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() },
      { repos: ['acme/api', 'acme/web', 'octo/cli'] }
    )
    render(<ReviewDashboard />)
    expect(await screen.findByRole('button', { name: /3 repositories/ })).toBeTruthy()
  })

  it('labels the scope button All repositories when nothing is selected', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    expect(await screen.findByRole('button', { name: /All repositories/ })).toBeTruthy()
  })

  it('falls back to scopedTo from the search for the label', async () => {
    mockInvoke({
      prs: [pr210],
      login: 'andytavares',
      fetchedAt: new Date().toISOString(),
      scopedTo: 12,
    })
    render(<ReviewDashboard />)
    expect(await screen.findByRole('button', { name: /12 repositories/ })).toBeTruthy()
  })

  it('saving the picker sends the selection and reloads the dashboard', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByText('REQUESTED OF YOU')
    const invoke = window.electronAPI.extensionBridge.invoke as ReturnType<typeof vi.fn>
    const searches = () =>
      invoke.mock.calls.filter((c: unknown[]) => c[0] === 'github:dashboard-search').length
    expect(searches()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /All repositories/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(searches()).toBe(2))
    expect(invoke).toHaveBeenCalledWith('github:review-repos-set', { repos: ['acme/api'] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('names the sections that failed and keeps the ones that loaded', async () => {
    mockInvoke({
      prs: [pr210],
      login: 'andytavares',
      fetchedAt: new Date().toISOString(),
      failed: [
        { section: 'involved', error: 'Command failed: gh api graphql -f query=...\ngh: HTTP 502' },
        { section: 'team', error: 'gh: HTTP 502' },
      ],
    })
    render(<ReviewDashboard />)
    const band = await screen.findByRole('alert')
    expect(band.textContent).toContain("Couldn't load Involved, Team: gh: HTTP 502.")
    expect(screen.getByText('REQUESTED OF YOU')).toBeTruthy()
    expect(screen.getByTestId('row-210')).toBeTruthy()
    expect(within(band).getByRole('button', { name: 'Choose repositories' })).toBeTruthy()
    expect(within(band).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('shows only the short message when every section failed', async () => {
    const query = 'query { search(query: "is:open is:pr") { nodes { number } } }'
    const failed = ['re-review', 'requested', 'team', 'mine', 'involved'].map((section) => ({
      section,
      error: `Command failed: gh api graphql -f query='${query}'\ngh: HTTP 502`,
    }))
    mockInvoke({ prs: [], login: 'andytavares', fetchedAt: new Date().toISOString(), failed })
    render(<ReviewDashboard />)
    await screen.findByText(/gh: HTTP 502/)
    expect(document.body.textContent).not.toContain('search(query')
    expect(screen.getByRole('button', { name: 'Choose repositories' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('trims an error result that carries the whole command', async () => {
    mockInvoke({ error: 'Command failed: gh api graphql -f query=query { x }\ngh: HTTP 401' })
    render(<ReviewDashboard />)
    await screen.findByText(/gh: HTTP 401/)
    expect(document.body.textContent).not.toContain('query { x }')
  })
})
