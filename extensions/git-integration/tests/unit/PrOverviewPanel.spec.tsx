import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrOverviewPanel } from '../../src/components/pr-review/PrOverviewPanel'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/stores/pr-review.store', () => ({ usePrReviewStore: vi.fn() }))

const mockSetView = vi.fn()
vi.mock('../../src/stores/git.store', () => ({
  useGitStore: () => ({ setView: mockSetView }),
}))

const mockSetActiveProjectTab = vi.fn()
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: () => ({ setActiveProjectTab: mockSetActiveProjectTab }),
}))

vi.mock('../../src/hooks/usePrReview', () => ({
  useLoadIssueComments: vi.fn(() => vi.fn()),
}))

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prMarkReady: vi.fn().mockResolvedValue({}),
    prIssueCommentAdd: vi.fn().mockResolvedValue({}),
    prUpdateBranch: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

const mockPreparePrWorktree = vi.fn()
vi.mock('../../src/api/merge-flow', () => ({
  mergeFlowAPI: {
    preparePrWorktree: (...a: unknown[]) => mockPreparePrWorktree(...a),
  },
}))

const mockCreateProject = vi.fn()
const mockSetActiveProject = vi.fn()
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    activeWorkspaceId: 'ws-1',
    createProject: mockCreateProject,
    setActiveProject: mockSetActiveProject,
  }),
}))

vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}))

vi.mock('../../src/components/pr-review/RichContent', () => ({
  RichContent: ({ children }: { children: string }) => (
    <div data-testid="rich-content">{children}</div>
  ),
}))

const makeFile = (
  path: string,
  level: 'low' | 'medium' | 'high',
  composite: number,
  additions = 10,
  deletions = 5
) => ({
  path,
  oldPath: undefined,
  changeType: 'modified' as const,
  additions,
  deletions,
  isBinary: false,
  tier: 1 as const,
  whyHere: 'test',
  riskScore: {
    level,
    composite,
    metrics: {
      changeSize: 15,
      churn90d: 5,
      blastRadius: 2,
      testFilePresent: true,
      complexityDelta: 0,
      patchCoverage: null,
    },
    dominantDriver: 'Change size',
    topImporters: [],
    importerCount: 0,
  },
  estimatedMinutes: 5,
})

const basePr: PrReviewDetail = {
  number: 42,
  title: 'Add feature X',
  body: 'This PR adds feature X.',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  headRefName: 'feature/x',
  baseRefName: 'main',
  headSHA: 'abc123',
  isDraft: false,
  mergeStateStatus: 'clean',
  ciStatus: 'passing',
  lintStatus: 'pass',
  coverageStatus: 'pass',
  statusChecks: [{ name: 'CI', state: 'pass' }],
  approvals: [],
  requestedReviewers: [],
  assigneeLogins: [],
  chapters: [
    {
      id: 'ch1',
      name: 'Core',
      estimatedMinutes: 15,
      status: 'not-started',
      files: [
        makeFile('src/high.ts', 'high', 80, 50, 20),
        makeFile('src/medium.ts', 'medium', 50, 30, 10),
        makeFile('src/low.ts', 'low', 10, 5, 2),
      ],
    },
  ],
  insights: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPreparePrWorktree.mockResolvedValue({ hasConflicts: true })
  mockCreateProject.mockResolvedValue({ project: { id: 'proj-conflict' } })
  // Stub window.electronAPI.git.suggestWorktreePath
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    git: {
      suggestWorktreePath: vi.fn().mockResolvedValue({ path: '/tmp/worktree/branch' }),
    },
  }
  vi.mocked(usePrReviewStore).mockReturnValue({
    viewedFiles: new Set(),
    issueComments: [],
    currentUserLogin: null,
  } as unknown as ReturnType<typeof usePrReviewStore>)
})

function renderPanel(overrides: Partial<PrReviewDetail> = {}, props = {}) {
  return render(
    <PrOverviewPanel
      repoRoot="/repo"
      pr={{ ...basePr, ...overrides }}
      sessionStatus="not-started"
      onStartReview={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  )
}

describe('PrOverviewPanel', () => {
  it('renders PR title and number', () => {
    const onStartReview = vi.fn()
    const onClose = vi.fn()
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={onStartReview}
        onClose={onClose}
      />
    )
    expect(screen.getByText('Add feature X')).toBeTruthy()
    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('renders author and branch info', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('feature/x → main')).toBeTruthy()
  })

  it('summarises passing checks and keeps the list collapsed', () => {
    renderPanel()
    expect(screen.getByText('1 check passing')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('names the failing checks in the summary and expands the full list on click', () => {
    renderPanel({
      statusChecks: [
        { name: 'Format', state: 'fail' },
        { name: 'codecov/patch', state: 'fail' },
        { name: 'build', state: 'pass' },
        { name: 'lint', state: 'pass' },
      ],
    })
    const summary = screen.getByRole('button', {
      name: /2 of 4 checks failing · Format, codecov\/patch/,
    })
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(summary)
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getByText('build')).toBeTruthy()
  })

  it('says how many checks are pending', () => {
    renderPanel({
      statusChecks: [
        { name: 'a', state: 'pending' },
        { name: 'b', state: 'pass' },
      ],
    })
    expect(screen.getByText('1 of 2 checks pending')).toBeTruthy()
  })

  it('shows Start Review for not-started PRs', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Start Review')).toBeTruthy()
  })

  it('shows Resume Review for paused PRs', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="paused"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Resume Review · 0 of 3 viewed')).toBeTruthy()
  })

  it('shows Continue Review for in-progress PRs', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="in-progress"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Continue Review · 0 of 3 viewed')).toBeTruthy()
  })

  it('calls onStartReview when start button is clicked', () => {
    const onStartReview = vi.fn()
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={onStartReview}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Start Review'))
    expect(onStartReview).toHaveBeenCalledOnce()
  })

  it('calls onClose when × is clicked', () => {
    const onClose = vi.fn()
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders PR description via RichContent', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByTestId('rich-content')).toBeTruthy()
    expect(screen.getByText('This PR adds feature X.')).toBeTruthy()
  })

  it('shows no-description message when body is empty', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, body: '' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('No description provided.')).toBeTruthy()
  })

  it('folds hotspot files into the risk row, leaving out low risk files', () => {
    renderPanel()
    const risk = screen.getByText('Risk').closest('.ib-score') as HTMLElement
    expect(screen.getByTitle('src/high.ts')).toBeTruthy()
    expect(screen.getByTitle('src/medium.ts')).toBeTruthy()
    expect(risk.textContent).toContain('Hotspots')
    expect(screen.queryByTitle('src/low.ts')).toBeNull()
    expect(screen.queryByText(/Hotspots — focus here first/)).toBeNull()
  })

  it('puts risk, time and size on one header line', () => {
    renderPanel()
    expect(screen.getByText('What to look at')).toBeTruthy()
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText(/about 15 min · 3 files, \+85 −32/)).toBeTruthy()
  })

  it('has no metric tiles and no high/med/low chips', () => {
    renderPanel()
    for (const label of ['Additions', 'Deletions', 'Est. time', 'Files', 'CI']) {
      expect(screen.queryByText(label)).toBeNull()
    }
    expect(screen.queryByText(/\d+ high$/)).toBeNull()
    expect(screen.queryByText(/\d+ med$/)).toBeNull()
    expect(screen.queryByText(/\d+ low$/)).toBeNull()
    expect(screen.queryByText('Passing')).toBeNull()
    expect(document.querySelector('.pr-overview-metric')).toBeNull()
  })

  it('shows analysis provenance as a tooltip, not as text', () => {
    renderPanel({
      insights: {
        complexity: { branchDelta: 3, functions: [], source: 'tree-sitter · hunk base vs head' },
        coverage: {
          changedFunctions: 0,
          testedFunctions: 0,
          untestedFunctions: [],
          patchPercent: null,
          source: 'CI check codecov/patch',
          changedSourceFiles: 0,
          changedSourceFilesWithTests: 0,
        },
        health: { flags: [], source: 'tree-sitter · detectDryViolations' },
        understandability: {
          level: 'easy',
          linesToRead: 10,
          newExports: 0,
          longestChain: 1,
          crossChapterRefs: 0,
          source: 'reading-order graph',
        },
      },
    })
    expect(screen.queryByText('tree-sitter · hunk base vs head')).toBeNull()
    expect(screen.getByTitle('tree-sitter · hunk base vs head')).toBeTruthy()
  })

  it('puts viewed progress on the footer button for a review under way', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/high.ts']),
      issueComments: [],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    renderPanel({}, { sessionStatus: 'in-progress' })
    expect(screen.getByRole('button', { name: 'Continue Review · 1 of 3 viewed' })).toBeTruthy()
    expect(screen.queryByText('1/3 reviewed')).toBeNull()
  })

  it('shows no progress on the footer button before a review starts', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Start Review' })).toBeTruthy()
  })

  it('renders age as "2d ago"', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('2d ago')).toBeTruthy()
  })

  it('renders age as "today" for same-day PRs', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, openedAt: new Date().toISOString() }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('today')).toBeTruthy()
  })

  it('renders optional pop out button when onPopOut is provided', () => {
    const onPopOut = vi.fn()
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
        onPopOut={onPopOut}
      />
    )
    const btn = screen.getByTitle('Open in focused window')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onPopOut).toHaveBeenCalledOnce()
  })

  it('shows approvals bar when PR has approvals', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{
          ...basePr,
          approvals: [
            { author: 'bob', authorAvatarUrl: '', submittedAt: new Date().toISOString() },
            { author: 'carol', authorAvatarUrl: '', submittedAt: new Date().toISOString() },
          ],
        }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Approved by bob, carol')).toBeTruthy()
  })

  it('does not show approvals bar when PR has no approvals', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText(/Approved by/)).toBeNull()
  })

  it('does not render pop out button when onPopOut is absent', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByTitle('Open in focused window')).toBeNull()
  })

  it('collapses the discussion behind a count, composer hidden', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /Discussion · 0/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByPlaceholderText('Leave a comment…')).toBeNull()
    expect(screen.queryByText('Write')).toBeNull()
  })

  it('keeps comments collapsed and shows their count', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [
        {
          id: 1,
          author: 'bob',
          authorAvatarUrl: '',
          body: 'Looks off',
          createdAt: new Date().toISOString(),
        },
      ],
      currentUserLogin: null,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    renderPanel()
    expect(screen.getByRole('button', { name: /Discussion · 1/ })).toBeTruthy()
    expect(screen.queryByText('Looks off')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Discussion · 1/ }))
    expect(screen.getByText('Looks off')).toBeTruthy()
  })

  it('renders write/preview tabs in the discussion composer once expanded', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Discussion/ }))
    expect(screen.getByText('Write')).toBeTruthy()
    expect(screen.getByText('Preview')).toBeTruthy()
    expect(screen.getByPlaceholderText('Leave a comment…')).toBeTruthy()
  })

  it('posts a comment from the expanded composer', async () => {
    const { githubAPI } = await import('../../src/api/github')
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Discussion/ }))
    fireEvent.change(screen.getByPlaceholderText('Leave a comment…'), {
      target: { value: 'Ship it' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() =>
      expect(githubAPI.prIssueCommentAdd).toHaveBeenCalledWith({
        repoRoot: '/repo',
        prNumber: 42,
        body: 'Ship it',
      })
    )
  })

  it('shows preview pane when Preview tab is clicked', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Discussion/ }))
    fireEvent.click(screen.getByText('Preview'))
    expect(screen.getByText('Nothing to preview.')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Leave a comment…')).toBeNull()
  })

  it('marks a draft ready from the footer', async () => {
    const { githubAPI } = await import('../../src/api/github')
    renderPanel({ isDraft: true })
    fireEvent.click(screen.getByText('Mark as Ready'))
    await waitFor(() => expect(githubAPI.prMarkReady).toHaveBeenCalledWith('/repo', 42))
  })

  it('shows "behind" badge when mergeStateStatus is behind', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'behind' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/Behind main/)).toBeTruthy()
  })

  it('shows "conflicts" badge when mergeStateStatus is dirty', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'dirty' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/Conflicts/)).toBeTruthy()
  })

  it('shows resolve conflicts button when mergeStateStatus is dirty', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'dirty' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/Resolve conflicts/i)).toBeTruthy()
  })

  it('does not show resolve conflicts button when mergeStateStatus is clean', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'clean' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText(/Resolve conflicts/i)).toBeNull()
  })

  it('resolve conflicts button prepares worktree then calls onStartMergeFlow', async () => {
    const onStartMergeFlow = vi.fn()
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'dirty' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
        onStartMergeFlow={onStartMergeFlow}
      />
    )
    fireEvent.click(screen.getByText(/Resolve conflicts/i))
    await waitFor(() => {
      expect(mockPreparePrWorktree).toHaveBeenCalledWith(
        '/repo',
        '/tmp/worktree/branch',
        basePr.headRefName,
        basePr.baseRefName
      )
      expect(onStartMergeFlow).toHaveBeenCalledWith('/tmp/worktree/branch')
    })
  })

  it('does not show merge state badge when mergeStateStatus is clean', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'clean' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText(/Behind/)).toBeNull()
    expect(screen.queryByText(/Conflicts/)).toBeNull()
  })

  it('shows update branch button when mergeStateStatus is behind', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'behind' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/Update from main/)).toBeTruthy()
  })

  it('does not show update branch button when mergeStateStatus is clean', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'clean' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText(/Update from/)).toBeNull()
  })

  it('calls prUpdateBranch and onRefresh when update branch button clicked', async () => {
    const { githubAPI } = await import('../../src/api/github')
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'behind' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
        onRefresh={onRefresh}
      />
    )
    fireEvent.click(screen.getByText(/Update from main/))
    await waitFor(() => {
      expect(githubAPI.prUpdateBranch).toHaveBeenCalledWith('/repo', 42)
      expect(onRefresh).toHaveBeenCalled()
    })
  })

  it('shows error message when prUpdateBranch returns error', async () => {
    const { githubAPI } = await import('../../src/api/github')
    vi.mocked(githubAPI.prUpdateBranch).mockResolvedValueOnce({ error: 'update failed' })
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'behind' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText(/Update from main/))
    await waitFor(() => {
      expect(screen.getByText('update failed')).toBeTruthy()
    })
  })

  it('shows requested reviewers as pending when no approvals', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, requestedReviewers: ['dave', 'eve'] }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Review requested from dave, eve')).toBeTruthy()
  })

  it('shows "Awaiting" label for pending reviewers when approvals already exist', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{
          ...basePr,
          approvals: [
            { author: 'bob', authorAvatarUrl: '', submittedAt: new Date().toISOString() },
          ],
          requestedReviewers: ['dave'],
        }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Approved by bob')).toBeTruthy()
    expect(screen.getByText('Awaiting dave')).toBeTruthy()
  })

  it('does not show reviewer bar when no approvals and no requested reviewers', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText(/Approved by/)).toBeNull()
    expect(screen.queryByText(/Review requested from/)).toBeNull()
  })

  it('shows "Your review requested" badge when current user is a requested reviewer', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [],
      currentUserLogin: 'alice',
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, requestedReviewers: ['alice', 'bob'] }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Your review requested')).toBeTruthy()
  })

  it('shows "Your review requested" badge when current user is an assignee', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [],
      currentUserLogin: 'alice',
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, assigneeLogins: ['alice'] }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Your review requested')).toBeTruthy()
  })

  it('does not show "Your review requested" badge when current user is not a reviewer or assignee', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [],
      currentUserLogin: 'alice',
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, requestedReviewers: ['bob'] }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText('Your review requested')).toBeNull()
  })
})
