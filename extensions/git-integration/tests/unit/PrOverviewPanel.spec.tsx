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

vi.mock('../../src/components/pr-review/StatusChecksBar', () => ({
  StatusChecksBar: ({ checks }: { checks: unknown[] }) => (
    <div data-testid="status-checks-bar" data-count={checks.length} />
  ),
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

  it('renders status checks bar', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const bar = screen.getByTestId('status-checks-bar')
    expect(bar).toBeTruthy()
    expect(bar.getAttribute('data-count')).toBe('1')
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
    expect(screen.getByText('Resume Review')).toBeTruthy()
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
    expect(screen.getByText('Continue Review')).toBeTruthy()
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

  it('renders hotspot files for high and medium risk', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Hotspots — focus here first')).toBeTruthy()
    // high.ts and medium.ts should appear; low.ts should not
    expect(screen.getByTitle('src/high.ts')).toBeTruthy()
    expect(screen.getByTitle('src/medium.ts')).toBeTruthy()
  })

  it('shows progress bar for in-progress reviews', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/high.ts']),
      issueComments: [],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="in-progress"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('1/3 reviewed')).toBeTruthy()
  })

  it('renders metric values', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // 3 files, +85, −32, 15m, Passing CI
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('+85')).toBeTruthy()
    expect(screen.getByText('−32')).toBeTruthy()
    expect(screen.getByText('15m')).toBeTruthy()
    expect(screen.getByText('Passing')).toBeTruthy()
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
    expect(screen.getByText('Approved by')).toBeTruthy()
    expect(screen.getByText('bob')).toBeTruthy()
    expect(screen.getByText('carol')).toBeTruthy()
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
    expect(screen.queryByText('Approved by')).toBeNull()
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

  it('renders write/preview tabs in discussion composer', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Write')).toBeTruthy()
    expect(screen.getByText('Preview')).toBeTruthy()
    expect(screen.getByPlaceholderText('Leave a comment…')).toBeTruthy()
  })

  it('shows preview pane when Preview tab is clicked', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Preview'))
    expect(screen.getByText('Nothing to preview.')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Leave a comment…')).toBeNull()
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
    expect(screen.getByText('⚠ Conflicts')).toBeTruthy()
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

  it('resolve conflicts button creates worktree project then switches to merge-flow view', async () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, mergeStateStatus: 'dirty' }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
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
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', isWorktree: true })
      )
      expect(mockSetActiveProject).toHaveBeenCalledWith('proj-conflict')
      expect(mockSetView).toHaveBeenCalledWith('merge-flow')
      expect(mockSetActiveProjectTab).toHaveBeenCalledWith('git')
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
    expect(screen.getByText('Review requested from')).toBeTruthy()
    expect(screen.getByText('dave')).toBeTruthy()
    expect(screen.getByText('eve')).toBeTruthy()
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
    expect(screen.getByText('Approved by')).toBeTruthy()
    expect(screen.getByText('Awaiting')).toBeTruthy()
    expect(screen.getByText('dave')).toBeTruthy()
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
    expect(screen.queryByText('Approved by')).toBeNull()
    expect(screen.queryByText('Review requested from')).toBeNull()
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
