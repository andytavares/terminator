import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

vi.mock('../../src/api/review-agent', () => ({
  reviewAgentAPI: { summarize: vi.fn().mockResolvedValue({ summary: 'A summary.' }) },
}))

vi.mock('../../src/components/pr-review/RichContent', () => ({
  RichContent: ({ children }: { children: string }) => (
    <div data-testid="rich-content">{children}</div>
  ),
}))

const overviewRiskScore = (level: 'low' | 'medium' | 'high', composite: number) => ({
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
})

const makeFile = (
  path: string,
  risk: { level: 'low' | 'medium' | 'high'; composite: number },
  size = { additions: 10, deletions: 5 }
) => ({
  path,
  oldPath: undefined,
  changeType: 'modified' as const,
  ...size,
  isBinary: false,
  tier: 1 as const,
  whyHere: 'test',
  riskScore: overviewRiskScore(risk.level, risk.composite),
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
  issueRefs: [],
  dryViolations: [],
  chapters: [
    {
      id: 'ch1',
      name: 'Core',
      estimatedMinutes: 15,
      status: 'not-started',
      files: [
        makeFile('src/high.ts', { level: 'high', composite: 80 }, { additions: 50, deletions: 20 }),
        makeFile(
          'src/medium.ts',
          { level: 'medium', composite: 50 },
          { additions: 30, deletions: 10 }
        ),
        makeFile('src/low.ts', { level: 'low', composite: 10 }, { additions: 5, deletions: 2 }),
      ],
    },
  ],
  readingOrder: [],
  movedBlocks: [],
  insights: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPreparePrWorktree.mockResolvedValue({ hasConflicts: true })
  mockCreateProject.mockResolvedValue({ project: { id: 'proj-conflict' } })
  // Stub window.electronAPI.git.suggestWorktreePath
  Object.assign(window, {
    electronAPI: {
      git: {
        suggestWorktreePath: vi.fn().mockResolvedValue({ path: '/tmp/worktree/branch' }),
      },
    },
  })
  vi.mocked(usePrReviewStore).mockReturnValue({
    viewedFiles: new Set(),
    issueComments: [],
    currentUserLogin: null,
  })
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

/** The "At a glance" aside, where status, people and linked issues sit. */
function atAGlance(): HTMLElement {
  return screen.getByRole('complementary', { name: 'At a glance' })
}

/** Renders the panel and opens one of its tabs. */
function renderOnTab(tab: RegExp, overrides: Partial<PrReviewDetail> = {}) {
  const view = renderPanel(overrides)
  fireEvent.click(screen.getByRole('tab', { name: tab }))
  return view
}

const bobsComment = {
  id: 1,
  author: 'bob',
  authorAvatarUrl: '',
  body: 'Looks off',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('PrOverviewPanel — the At a glance aside', () => {
  it('labels a row for each fact about the pull request', () => {
    renderPanel()
    const aside = within(atAGlance())
    for (const label of ['Checks', 'Reviewers', 'Author', 'Branch', 'Opened', 'Merge state']) {
      expect(aside.getByText(label)).toBeTruthy()
    }
    expect(aside.getByText('alice')).toBeTruthy()
    expect(aside.getByText('feature/x → main')).toBeTruthy()
    expect(aside.queryByText('Linked issues')).toBeNull()
  })

  it('lists linked issues only when the pull request has some', () => {
    renderPanel({ issueRefs: [{ ref: '#7', type: 'github', title: 'Crash on save' }] })
    const aside = within(atAGlance())
    expect(aside.getByText('Linked issues')).toBeTruthy()
    expect(aside.getByText('#7')).toBeTruthy()
    expect(aside.getByText('Crash on save')).toBeTruthy()
  })

  it('says so when there are no checks and no reviewers', () => {
    renderPanel({ statusChecks: [] })
    const aside = within(atAGlance())
    expect(aside.getByText('No checks')).toBeTruthy()
    expect(aside.getByText('None requested')).toBeTruthy()
    expect(aside.getByText('No conflicts')).toBeTruthy()
  })
})

describe('PrOverviewPanel — the tabs beside it', () => {
  it('offers Description, Discussion with its count, and Insights, Description first', () => {
    renderPanel()
    const tabs = screen.getAllByRole('tab', { name: /^(Description|Discussion · 0|Insights)$/ })
    expect(tabs.map((t) => t.textContent)).toEqual(['Description', 'Discussion · 0', 'Insights'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  })

  it("keeps only the selected tab's panel in the document", () => {
    renderPanel()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByText('This PR adds feature X.')).toBeTruthy()
    expect(screen.queryByText('What to look at')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Insights' }))
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByText('What to look at')).toBeTruthy()
    expect(screen.queryByText('This PR adds feature X.')).toBeNull()
  })

  it('offers Summarize on the description and keeps the summary across tab switches', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    expect(await screen.findByText('A summary.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Insights' }))
    expect(screen.queryByText('A summary.')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Description' }))
    expect(screen.getByText('A summary.')).toBeTruthy()
  })
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
})

describe('PrOverviewPanel — renders author and branch info', () => {
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
    expect(within(atAGlance()).getByText('1 check passing')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })
})

describe('PrOverviewPanel — names the failing checks in the summary and expands the full list on click', () => {
  it('names the failing checks in the summary and expands the full list on click', () => {
    renderPanel({
      statusChecks: [
        { name: 'Format', state: 'fail' },
        { name: 'codecov/patch', state: 'fail' },
        { name: 'build', state: 'pass' },
        { name: 'lint', state: 'pass' },
      ],
    })
    const summary = within(atAGlance()).getByRole('button', {
      name: /2 of 4 checks failing · Format, codecov\/patch/,
    })
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(summary)
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getByText('build')).toBeTruthy()
  })
})

describe('PrOverviewPanel — says how many checks are pending', () => {
  it('says how many checks are pending', () => {
    renderPanel({
      statusChecks: [
        { name: 'a', state: 'pending' },
        { name: 'b', state: 'pass' },
      ],
    })
    expect(within(atAGlance()).getByText('1 of 2 checks pending')).toBeTruthy()
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
})

describe('PrOverviewPanel — shows Resume Review for paused PRs', () => {
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
})

describe('PrOverviewPanel — calls onStartReview when start button is clicked', () => {
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
})

describe('PrOverviewPanel — calls onClose when × is clicked', () => {
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
})

describe('PrOverviewPanel — renders PR description via RichContent', () => {
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
})

describe('PrOverviewPanel — folds hotspot files into the risk row, leaving out low risk files', () => {
  it('folds hotspot files into the risk row, leaving out low risk files', () => {
    renderOnTab(/Insights/)
    const risk = screen.getByText('Risk').closest('.ib-score') as HTMLElement
    expect(screen.getByTitle('src/high.ts')).toBeTruthy()
    expect(screen.getByTitle('src/medium.ts')).toBeTruthy()
    expect(risk.textContent).toContain('Hotspots')
    expect(screen.queryByTitle('src/low.ts')).toBeNull()
    expect(screen.queryByText(/Hotspots — focus here first/)).toBeNull()
  })

  it('puts risk, time and size on one header line', () => {
    renderOnTab(/Insights/)
    expect(screen.getByText('What to look at')).toBeTruthy()
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText(/about 15 min · 3 files, \+85 −32/)).toBeTruthy()
  })
})

describe('PrOverviewPanel — has no metric tiles and no high/med/low chips', () => {
  it('has no metric tiles and no high/med/low chips', () => {
    renderOnTab(/Insights/)
    for (const label of ['Additions', 'Deletions', 'Est. time', 'Files', 'CI']) {
      expect(screen.queryByText(label)).toBeNull()
    }
    expect(screen.queryByText(/\d+ high$/)).toBeNull()
    expect(screen.queryByText(/\d+ med$/)).toBeNull()
    expect(screen.queryByText(/\d+ low$/)).toBeNull()
    expect(screen.queryByText('Passing')).toBeNull()
    expect(document.querySelector('.pr-overview-metric')).toBeNull()
  })
})

describe('PrOverviewPanel — shows analysis provenance as a tooltip, not as text', () => {
  it('shows analysis provenance as a tooltip, not as text', () => {
    renderOnTab(/Insights/, {
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
})

describe('PrOverviewPanel — puts viewed progress on the footer button for a review under way', () => {
  it('puts viewed progress on the footer button for a review under way', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/high.ts']),
      issueComments: [],
    })
    renderPanel({}, { sessionStatus: 'in-progress' })
    expect(screen.getByRole('button', { name: 'Continue Review · 1 of 3 viewed' })).toBeTruthy()
    expect(screen.queryByText('1/3 reviewed')).toBeNull()
  })

  it('shows no progress on the footer button before a review starts', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Start Review' })).toBeTruthy()
  })
})

describe('PrOverviewPanel — says how long ago the pull request was opened', () => {
  it('says how long ago the pull request was opened', () => {
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('2 days ago').getAttribute('datetime')).toBe(basePr.openedAt)
  })
})

describe('PrOverviewPanel — renders optional pop out button when onPopOut is provided', () => {
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
})

describe('PrOverviewPanel — shows approvals bar when PR has approvals', () => {
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
    expect(within(atAGlance()).getByText('Approved by bob, carol')).toBeTruthy()
  })
})

describe('PrOverviewPanel — does not show approvals bar when PR has no approvals', () => {
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
    expect(within(atAGlance()).queryByText(/Approved by/)).toBeNull()
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
})

describe('PrOverviewPanel — keeps the discussion behind its tab', () => {
  it('shows no composer until the Discussion tab is selected', () => {
    renderPanel()
    expect(screen.queryByPlaceholderText('Leave a comment…')).toBeNull()
    expect(screen.queryByText('Write')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /Discussion · 0/ }))
    expect(screen.getByPlaceholderText('Leave a comment…')).toBeTruthy()
  })

  it('counts the comments on the tab and lists them once it is selected', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [bobsComment],
      currentUserLogin: null,
    })
    renderPanel()
    expect(screen.queryByText('Looks off')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /Discussion · 1/ }))
    expect(screen.getByText('Looks off')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeTruthy()
  })

  it('offers no Summarize on a discussion with no comments', () => {
    renderOnTab(/Discussion · 0/)
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull()
  })
})

describe('PrOverviewPanel — renders write/preview tabs in the discussion composer once its tab is selected', () => {
  it('renders write/preview tabs in the discussion composer once its tab is selected', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: /Discussion/ }))
    expect(screen.getByText('Write')).toBeTruthy()
    expect(screen.getByText('Preview')).toBeTruthy()
    expect(screen.getByPlaceholderText('Leave a comment…')).toBeTruthy()
  })

  it('posts a comment from the discussion composer', async () => {
    const { githubAPI } = await import('../../src/api/github')
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: /Discussion/ }))
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
})

describe('PrOverviewPanel — shows preview pane when Preview tab is clicked', () => {
  it('shows preview pane when Preview tab is clicked', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: /Discussion/ }))
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
})

describe('PrOverviewPanel — shows behind badge when mergeStateStatus is behind', () => {
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
})

describe('PrOverviewPanel — shows resolve conflicts button when mergeStateStatus is dirty', () => {
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
})

describe('PrOverviewPanel — resolve conflicts button prepares worktree then calls onStartMergeFlow', () => {
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
      expect(mockPreparePrWorktree).toHaveBeenCalledWith({
        repoRoot: '/repo',
        worktreePath: '/tmp/worktree/branch',
        headRefName: basePr.headRefName,
        baseRefName: basePr.baseRefName,
      })
      expect(onStartMergeFlow).toHaveBeenCalledWith('/tmp/worktree/branch')
    })
  })
})

describe('PrOverviewPanel — does not show merge state badge when mergeStateStatus is clean', () => {
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
})

describe('PrOverviewPanel — does not show update branch button when mergeStateStatus is clean', () => {
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
})

describe('PrOverviewPanel — calls prUpdateBranch and onRefresh when update branch button clicked', () => {
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
})

describe('PrOverviewPanel — shows error message when prUpdateBranch returns error', () => {
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
})

describe('PrOverviewPanel — shows requested reviewers as pending when no approvals', () => {
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
    expect(within(atAGlance()).getByText('Review requested from dave, eve')).toBeTruthy()
  })
})

describe('PrOverviewPanel — shows Awaiting label for pending reviewers when approvals already exist', () => {
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
    expect(within(atAGlance()).getByText('Approved by bob')).toBeTruthy()
    expect(within(atAGlance()).getByText('Awaiting dave')).toBeTruthy()
  })
})

describe('PrOverviewPanel — does not show reviewer bar when no approvals and no requested reviewers', () => {
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
    expect(within(atAGlance()).queryByText(/Approved by/)).toBeNull()
    expect(within(atAGlance()).queryByText(/Review requested from/)).toBeNull()
  })
})

describe('PrOverviewPanel — shows Your review requested badge when current user is a requested reviewer', () => {
  it('shows "Your review requested" badge when current user is a requested reviewer', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [],
      currentUserLogin: 'alice',
    })
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, requestedReviewers: ['alice', 'bob'] }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(within(atAGlance()).getByText('Your review requested')).toBeTruthy()
  })
})

describe('PrOverviewPanel — shows Your review requested badge when current user is an assignee', () => {
  it('shows "Your review requested" badge when current user is an assignee', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [],
      currentUserLogin: 'alice',
    })
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, assigneeLogins: ['alice'] }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(within(atAGlance()).getByText('Your review requested')).toBeTruthy()
  })
})

describe('PrOverviewPanel — does not show Your review requested badge when current user is not a reviewer or assignee', () => {
  it('does not show "Your review requested" badge when current user is not a reviewer or assignee', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [],
      currentUserLogin: 'alice',
    })
    render(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={{ ...basePr, requestedReviewers: ['bob'] }}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(within(atAGlance()).queryByText('Your review requested')).toBeNull()
  })
})
