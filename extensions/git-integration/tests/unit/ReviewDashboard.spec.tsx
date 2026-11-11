import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewDashboard } from '../../src/components/pr-review/ReviewDashboard'
import type { DashboardPR } from '../../src/schemas/pr-review.schema'
import { useReviewUiStore } from '../../src/stores/review-ui.store'

function makePr(overrides: Partial<DashboardPR> = {}): DashboardPR {
  return {
    repo: 'andytavares/terminator',
    localRepoRoot: '/repo/terminator',
    section: 'requested',
    reviewedByMe: false,
    number: 1,
    title: 'Sample PR',
    url: 'https://github.com/andytavares/terminator/pull/1',
    author: 'alice',
    isDraft: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    additions: 10,
    deletions: 5,
    fileCount: 2,
    ciStatus: 'passing',
    reviewDecision: 'review-required',
    unresolvedThreads: 0,
    commitsSinceMyReview: 0,
    reviewerCount: 1,
    sessionStatus: 'not-started',
    viewedFileCount: 0,
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
  ciStatus: 'passing',
  reviewDecision: 'changes-requested',
  unresolvedThreads: 2,
  createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
})

interface InvokeOptions {
  cloneFolder?: string
  cloneResult?: unknown
  cloneError?: Error
  repos?: string[]
}

const ACCESSIBLE_REPOS = () => ({
  repos: [
    { fullName: 'acme/api', owner: 'acme', private: false, pushedAt: new Date().toISOString() },
    { fullName: 'acme/web', owner: 'acme', private: true, pushedAt: new Date().toISOString() },
  ],
})

function cloneAnswer(options: InvokeOptions): Promise<unknown> {
  if (options.cloneError) return Promise.reject(options.cloneError)
  return Promise.resolve(options.cloneResult ?? { repoRoot: '/cloned/terminator' })
}

/** The bridge's answer to each channel the dashboard calls. */
function answerFor(
  channel: string,
  dashboardResult: unknown,
  options: InvokeOptions
): Promise<unknown> {
  if (channel === 'github:dashboard-search') return Promise.resolve(dashboardResult)
  if (channel === 'github:review-settings')
    return Promise.resolve({ cloneFolder: options.cloneFolder ?? '', repos: options.repos ?? [] })
  if (channel === 'github:accessible-repos') return Promise.resolve(ACCESSIBLE_REPOS())
  if (channel === 'github:clone-repo') return cloneAnswer(options)
  return Promise.resolve({})
}

function mockInvoke(dashboardResult: unknown, options: InvokeOptions = {}) {
  const invoke = vi.fn((channel: string) => answerFor(channel, dashboardResult, options))
  Object.assign(window, {
    electronAPI: {
      extensionBridge: {
        invoke,
        on: vi.fn(() => () => {}),
      },
      shell: {
        openExternal: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useReviewUiStore.setState({ dashboardSort: 'newest' })
})

/** Matches the one element whose whole text, across its child elements, is `text`. */
const wholeText = (text: string) => (_: string, node: Element | null) => node?.textContent === text

describe('ReviewDashboard', () => {
  it('says how old a pull request is in short form on the second line', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    const row = await screen.findByTestId('row-210')
    expect(within(row).getByTestId('pr-meta').textContent).toContain('alice · 3d')
  })

  it.each([
    ['its title', () => screen.findByText('Foundry: the red team argues before agreement')],
    ['its Review button', () => screen.findByRole('button', { name: 'Review' })],
  ])('opens a pull request when %s is clicked', async (_target, findTarget) => {
    const user = userEvent.setup()
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await user.click(await findTarget())
    await waitFor(() => {
      expect(window.electronAPI.extensionBridge.invoke).toHaveBeenCalledWith(
        'window:open-pr-review',
        { repoRoot: '/repo/terminator', prNumber: '210', showOverview: 'true' }
      )
    })
  })

  it('does not repeat the needs-you count in the top bar', async () => {
    mockInvoke({ prs: [pr210, pr212], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByTestId('row-210')
    expect(screen.getByTestId('dashboard-bar').textContent).not.toMatch(/need you/)
  })
})

describe('ReviewDashboard — CI wording on My PRs rows', () => {
  const noChecks = makePr({ number: 300, section: 'mine', ciStatus: 'none' })
  const failing = makePr({ number: 301, section: 'mine', ciStatus: 'failing' })

  it('reads "no checks" for a pull request without checks', async () => {
    const user = userEvent.setup()
    mockInvoke({ prs: [noChecks, failing], login: 'a', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await user.click(screen.getByRole('tab', { name: /My PRs/ }))
    const quiet = await screen.findByTestId('row-300')
    expect(quiet.textContent).toContain('no checks')
    expect(quiet.textContent).not.toContain('CI pending')
  })

  it.each(['row-300', 'row-301'])('names CI at most once on %s', async (rowId) => {
    const user = userEvent.setup()
    mockInvoke({ prs: [noChecks, failing], login: 'a', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await user.click(screen.getByRole('tab', { name: /My PRs/ }))
    const row = await screen.findByTestId(rowId)
    expect(row.textContent!.match(/CI/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })
})

describe('ReviewDashboard — shows 50+ on the tab and heading of a capped section', () => {
  it('shows 50+ on the tab and heading of a capped section', async () => {
    mockInvoke({
      prs: [pr210, pr212],
      capped: ['team'],
      login: 'a',
      fetchedAt: new Date().toISOString(),
    })
    render(<ReviewDashboard />)
    await screen.findByTestId('row-210')
    expect(within(screen.getByRole('tablist')).getByText('50+')).toBeTruthy()
    const team = screen.getByRole('region', { name: 'REQUESTED OF YOUR TEAM' })
    expect(within(team).getByText('50+')).toBeTruthy()
    const requested = screen.getByRole('region', { name: 'REQUESTED OF YOU' })
    expect(within(requested).queryByText('50+')).toBeNull()
  })
})

describe('ReviewDashboard — repository name on the second line', () => {
  it('names the repository on the second line when more than one repository shows', async () => {
    const other = makePr({ repo: 'acme/api', number: 400, title: 'Other repo PR' })
    mockInvoke({ prs: [pr210, other], login: 'a', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    const row = await screen.findByTestId('row-400')
    expect(within(row).getByTestId('pr-meta').textContent!.startsWith('api')).toBe(true)
  })

  it('leaves the repository name out when only one repository shows', async () => {
    mockInvoke({ prs: [pr210], login: 'a', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    const single = await screen.findByTestId('row-210')
    expect(within(single).getByTestId('pr-meta').textContent).not.toContain('terminator')
  })
})

describe('ReviewDashboard — sorts each section with the chosen sort', () => {
  it('sorts each section with the chosen sort', async () => {
    const user = userEvent.setup()
    const waiting = makePr({
      number: 501,
      title: 'New waiting',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    })
    const ready = makePr({
      number: 502,
      title: 'Ready one',
      reviewDecision: 'approved',
      createdAt: new Date(Date.now() - 9 * 86400000).toISOString(),
    })
    mockInvoke({ prs: [ready, waiting], login: 'a', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByTestId('row-501')
    const order = () => screen.getAllByTestId(/^row-/).map((r) => r.getAttribute('data-testid'))
    expect(order()).toEqual(['row-501', 'row-502'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'closest')
    expect(order()).toEqual(['row-502', 'row-501'])
    expect(screen.queryByText(/Sorted by closest/)).toBeNull()
  })
})

describe('ReviewDashboard — reloads when a review is submitted elsewhere', () => {
  it('reloads when a review is submitted elsewhere', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    const bridge = window.electronAPI.extensionBridge
    const listeners: Record<string, (data?: unknown) => void> = {}
    vi.mocked(bridge.on).mockImplementation((channel: string, cb: (data: unknown) => void) => {
      listeners[channel] = cb
      return () => {}
    })
    render(<ReviewDashboard />)
    await screen.findByText('REQUESTED OF YOU')
    vi.mocked(bridge.invoke).mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'github:dashboard-search'
          ? { prs: [], login: 'andytavares', fetchedAt: new Date().toISOString() }
          : {}
      )
    )
    listeners['reviews:changed']()
    await screen.findByText('Nothing needs you')
  })
})

describe('ReviewDashboard — names each tab with its count, read apart from the words', () => {
  it('names each tab with its count, read apart from the words', async () => {
    mockInvoke({
      prs: [pr211, pr210, pr212, pr213],
      login: 'andytavares',
      fetchedAt: new Date().toISOString(),
    })
    render(<ReviewDashboard />)
    expect(await screen.findByRole('tab', { name: 'Needs you, 3' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'My PRs, 1' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Involved, 0' })).toBeTruthy()
  })

  it('moves between sections with the arrow keys and shows the selected one', async () => {
    const user = userEvent.setup()
    mockInvoke({ prs: [pr211, pr213], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByText('RE-REVIEW · NEW COMMITS SINCE YOU REVIEWED')
    const needs = screen.getByRole('tab', { name: /Needs you/ })
    needs.focus()
    expect(needs.matches(':focus')).toBe(true)
    await user.keyboard('{ArrowRight}')
    const mine = screen.getByRole('tab', { name: /My PRs/ })
    expect(mine.matches(':focus')).toBe(true)
    expect(mine.getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(mine.id)
    expect(within(panel).getByText('YOUR OPEN PRS')).toBeTruthy()
  })
})

describe('ReviewDashboard — puts the reviews requested of you above every other group', () => {
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
  })
})

describe('ReviewDashboard — omits an empty group', () => {
  it('omits an empty group', async () => {
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByText('REQUESTED OF YOU')
    expect(screen.queryByText(/RE-REVIEW/)).toBeNull()
    expect(screen.queryByText('REQUESTED OF YOUR TEAM')).toBeNull()
  })

  it('switches to My PRs tab and shows its rows', async () => {
    const user = userEvent.setup()
    mockInvoke({ prs: [pr211, pr213], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByText('RE-REVIEW · NEW COMMITS SINCE YOU REVIEWED')
    await user.click(await screen.findByRole('tab', { name: /My PRs/ }))
    await screen.findByText('YOUR OPEN PRS')
    expect(screen.getAllByText(wholeText('+1,385 −246 · 109 files'))).not.toHaveLength(0)
    expect(screen.getByText('changes requested')).toBeTruthy()
  })
})

describe('ReviewDashboard — keeps the Open label and notes Not cloned when localRepoRoot is null', () => {
  it('keeps the "Open" label and notes "Not cloned" when localRepoRoot is null', async () => {
    const user = userEvent.setup()
    mockInvoke({ prs: [pr213], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await user.click(screen.getByRole('tab', { name: /My PRs/ }))
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy()
    expect(screen.getByText(/Not cloned.*diff only/)).toBeTruthy()
  })
})

describe('ReviewDashboard — opens an uncloned row via the gh: pseudo repo root', () => {
  it('opens an uncloned row via the gh: pseudo repo root', async () => {
    const user = userEvent.setup()
    mockInvoke({ prs: [pr213], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await user.click(screen.getByRole('tab', { name: /My PRs/ }))
    const btn = await screen.findByRole('button', { name: 'Open' })
    await user.click(btn)
    await waitFor(() => {
      expect(window.electronAPI.extensionBridge.invoke).toHaveBeenCalledWith(
        'window:open-pr-review',
        { repoRoot: 'gh:andytavares/terminator', prNumber: '213', showOverview: 'true' }
      )
    })
  })
})

describe('ReviewDashboard — shows Clone and review only when a clone folder is configured, and clones then opens', () => {
  it('shows "Clone and review" only when a clone folder is configured, and clones then opens', async () => {
    const user = userEvent.setup()
    mockInvoke(
      { prs: [pr213], login: 'andytavares', fetchedAt: new Date().toISOString() },
      { cloneFolder: '/Users/me/repos', cloneResult: { repoRoot: '/Users/me/repos/terminator' } }
    )
    render(<ReviewDashboard />)
    await user.click(screen.getByRole('tab', { name: /My PRs/ }))
    const cloneBtn = await screen.findByRole('button', { name: 'Clone and review' })
    await user.click(cloneBtn)
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
})

describe('ReviewDashboard — does not show Clone and review when no clone folder is configured', () => {
  it('does not show "Clone and review" when no clone folder is configured', async () => {
    const user = userEvent.setup()
    mockInvoke(
      { prs: [pr213], login: 'andytavares', fetchedAt: new Date().toISOString() },
      { cloneFolder: '' }
    )
    render(<ReviewDashboard />)
    await user.click(screen.getByRole('tab', { name: /My PRs/ }))
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
})

describe('ReviewDashboard — says "1 repository" for a selection of one', () => {
  it('says "1 repository" for a selection of one', async () => {
    mockInvoke(
      { prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() },
      { repos: ['acme/api'] }
    )
    render(<ReviewDashboard />)
    expect(
      await screen.findByRole('button', { name: '1 repository, choose repositories' })
    ).toBeTruthy()
  })
})

describe('ReviewDashboard — labels the scope button All repositories when nothing is selected', () => {
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
})

describe('ReviewDashboard — saving the picker sends the selection and reloads the dashboard', () => {
  it('saving the picker sends the selection and reloads the dashboard', async () => {
    const user = userEvent.setup()
    mockInvoke({ prs: [pr210], login: 'andytavares', fetchedAt: new Date().toISOString() })
    render(<ReviewDashboard />)
    await screen.findByText('REQUESTED OF YOU')
    const invoke = window.electronAPI.extensionBridge.invoke as ReturnType<typeof vi.fn>
    const searches = () =>
      invoke.mock.calls.filter((c: unknown[]) => c[0] === 'github:dashboard-search').length
    expect(searches()).toBe(1)
    await user.click(screen.getByRole('button', { name: /All repositories/ }))
    await user.click(await screen.findByRole('checkbox', { name: 'acme/api' }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(searches()).toBe(2))
    expect(invoke).toHaveBeenCalledWith('github:review-repos-set', { repos: ['acme/api'] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('ReviewDashboard — names the sections that failed and keeps the ones that loaded', () => {
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
})

describe('ReviewDashboard — shows only the short message when every section failed', () => {
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
