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

/** The pane width usePaneWidth reports; null is a pane not yet measured, drawn as wide. */
const pane = vi.hoisted(() => ({ width: null as number | null }))
vi.mock('../../src/hooks/usePaneWidth', () => ({
  usePaneWidth: () => ({ paneRef: () => {}, width: pane.width }),
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
  ownedPaths: [],
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
  pane.width = null
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

const bobsComment = {
  id: 1,
  author: 'bob',
  authorAvatarUrl: '',
  body: 'Looks off',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

/** The buttons in the header, where Mark as ready and Start review first sit. */
function headerActions(): HTMLElement {
  return screen.getByRole('group', { name: 'Pull request actions' })
}

function readiness(): HTMLElement {
  return screen.getByRole('group', { name: 'Status' })
}

function openDiscussion() {
  fireEvent.click(screen.getByRole('tab', { name: /Discussion/ }))
}

const approval = (author: string) => ({
  author,
  authorAvatarUrl: '',
  submittedAt: new Date().toISOString(),
})

describe('PrOverviewPanel — the header', () => {
  it('shows the title and number in the page heading', () => {
    renderPanel()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toContain('Add feature X')
    expect(heading.textContent).toContain('#42')
    expect(heading.textContent).not.toContain('Draft')
  })

  it('marks a draft in the heading', () => {
    renderPanel({ isDraft: true })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Draft')
  })

  it('puts author, branches, size and time on the meta line', () => {
    renderPanel()
    const meta = within(screen.getByRole('group', { name: 'Pull request summary' }))
    expect(meta.getByText('alice')).toBeTruthy()
    expect(meta.getByText('feature/x')).toBeTruthy()
    expect(meta.getByText('main')).toBeTruthy()
    expect(meta.getByText('3 files')).toBeTruthy()
    expect(meta.getByText('+85')).toBeTruthy()
    expect(meta.getByText('−32')).toBeTruthy()
    expect(meta.getByText('about 15 min')).toBeTruthy()
    expect(meta.getByText('2 days ago').getAttribute('datetime')).toBe(basePr.openedAt)
  })
})

describe('PrOverviewPanel — the header actions', () => {
  it('closes from the Close button', () => {
    const onClose = vi.fn()
    renderPanel({}, { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('offers pop out only when the caller can', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: 'Open in focused window' })).toBeNull()
  })

  it('pops out when asked to', () => {
    const onPopOut = vi.fn()
    renderPanel({}, { onPopOut })
    fireEvent.click(screen.getByRole('button', { name: 'Open in focused window' }))
    expect(onPopOut).toHaveBeenCalledOnce()
  })

  it('offers Mark as ready only on a draft', () => {
    renderPanel()
    expect(within(headerActions()).queryByRole('button', { name: 'Mark as ready' })).toBeNull()
  })

  it('marks a draft ready', async () => {
    const { githubAPI } = await import('../../src/api/github')
    renderPanel({ isDraft: true })
    fireEvent.click(within(headerActions()).getByRole('button', { name: 'Mark as ready' }))
    await waitFor(() => expect(githubAPI.prMarkReady).toHaveBeenCalledWith('/repo', 42))
  })
})

describe('PrOverviewPanel — the start button label', () => {
  it.each([
    ['not-started', 'Start review'],
    ['paused', 'Resume review · 0 of 3 viewed'],
    ['in-progress', 'Continue review · 0 of 3 viewed'],
  ])('labels the button for a %s review', (sessionStatus, label) => {
    renderPanel({}, { sessionStatus })
    expect(within(headerActions()).getByRole('button', { name: label })).toBeTruthy()
  })
})

describe('PrOverviewPanel — starting the review', () => {
  it('counts the files already viewed', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/high.ts']),
      issueComments: [],
    })
    renderPanel({}, { sessionStatus: 'in-progress' })
    expect(screen.getAllByRole('button', { name: 'Continue review · 1 of 3 viewed' })).toHaveLength(
      2
    )
  })

  it('starts at the first chapter when no chapter is chosen', () => {
    const onStartReview = vi.fn()
    renderPanel({}, { onStartReview })
    fireEvent.click(within(headerActions()).getByRole('button', { name: 'Start review' }))
    expect(onStartReview).toHaveBeenCalledWith()
  })

  it('starts at the chapter whose plan row is clicked', () => {
    const onStartReview = vi.fn()
    renderPanel({}, { onStartReview })
    fireEvent.click(screen.getByRole('button', { name: 'Start here: Core' }))
    expect(onStartReview).toHaveBeenCalledWith('ch1')
  })
})

describe('PrOverviewPanel — the tabs', () => {
  it('offers Change and Discussion with its count, and no Insights', () => {
    renderPanel()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Change', 'Discussion · 0'])
    expect(screen.getByRole('tab', { name: 'Discussion, 0' })).toBe(tabs[1])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('tab', { name: 'Insights' })).toBeNull()
  })

  it('draws the properties rail beside the tab panel, not inside it', () => {
    renderPanel()
    const rail = screen.getByRole('complementary', { name: 'Pull request details' })
    expect(screen.getByRole('tabpanel', { name: 'Change' }).contains(rail)).toBe(false)
  })

  it('keeps the properties rail beside the discussion', () => {
    renderPanel()
    openDiscussion()
    const rail = screen.getByRole('complementary', { name: 'Pull request details' })
    expect(within(rail).getByRole('heading', { name: 'Signals' })).toBeTruthy()
  })

  it('keeps only the selected tab in the document', () => {
    renderPanel()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    openDiscussion()
    expect(screen.queryByText('This PR adds feature X.')).toBeNull()
  })
})

describe('PrOverviewPanel — the readiness strip', () => {
  it('is present under the header', () => {
    renderPanel()
    expect(within(readiness()).getByText('Checks')).toBeTruthy()
    expect(within(readiness()).getByText('Merge')).toBeTruthy()
  })

  it('names approvers and who the review is still waiting on', () => {
    renderPanel({ approvals: [approval('bob'), approval('carol')], requestedReviewers: ['dave'] })
    expect(within(readiness()).getByText(/Approved by bob, carol/)).toBeTruthy()
  })

  it.each([
    ['a requested reviewer', { requestedReviewers: ['alice', 'bob'] }],
    ['an assignee', { assigneeLogins: ['alice'] }],
  ])('flags that your review is requested when you are %s', (_who, overrides) => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [],
      currentUserLogin: 'alice',
    })
    renderPanel(overrides)
    expect(within(readiness()).getByText('Your review requested')).toBeTruthy()
  })

  it('does not flag a review nobody asked you for', () => {
    renderPanel({ requestedReviewers: ['bob'] })
    expect(screen.queryByText('Your review requested')).toBeNull()
  })
})

describe('PrOverviewPanel — the description', () => {
  it('reads the description under its own heading', () => {
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Description' })).toBeTruthy()
    expect(screen.getByText('alice wrote')).toBeTruthy()
    expect(screen.getByTestId('rich-content').textContent).toBe('This PR adds feature X.')
  })

  it('says so when there is no description', () => {
    renderPanel({ body: '' })
    expect(screen.getByText('No description provided.')).toBeTruthy()
  })

  it('clamps the description before any summary exists', () => {
    renderPanel()
    const reading = screen.getByTestId('rich-content').parentElement
    expect(reading?.classList.contains('pr-overview-reading--clamped')).toBe(true)
  })
})

function stubDescriptionHeights(scrollHeight: number, clientHeight: number) {
  const proto = HTMLElement.prototype
  const original = {
    scrollHeight: Object.getOwnPropertyDescriptor(proto, 'scrollHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(proto, 'clientHeight'),
  }
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(proto, 'clientHeight', { configurable: true, value: clientHeight })
  return () => {
    for (const key of ['scrollHeight', 'clientHeight'] as const) {
      const descriptor = original[key]
      if (descriptor) Object.defineProperty(proto, key, descriptor)
      else delete (proto as unknown as Record<string, unknown>)[key]
    }
  }
}

describe('PrOverviewPanel — clamping the description', () => {
  it('offers no expand button when the clamped description fits', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    await screen.findByText('A summary.')
    expect(screen.queryByRole('button', { name: 'Show full description' })).toBeNull()
  })

  it('offers the full description of a long one, and clamps it again on request', async () => {
    const restore = stubDescriptionHeights(900, 300)
    try {
      await expectClampThenExpand()
    } finally {
      restore()
    }
  })

  async function expectClampThenExpand() {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Show full description' }))
    const reading = screen.getByTestId('rich-content').parentElement
    expect(reading?.classList.contains('pr-overview-reading--clamped')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(reading?.classList.contains('pr-overview-reading--clamped')).toBe(true)
  }
})

describe('PrOverviewPanel — the summary and tabs', () => {
  it('keeps the summary across a tab switch', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    await screen.findByText('A summary.')
    openDiscussion()
    expect(screen.queryByText('A summary.')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Change' }))
    expect(screen.getByText('A summary.')).toBeTruthy()
  })

  it('draws the description summary inside the Change panel', async () => {
    renderPanel()
    const change = screen.getByRole('tabpanel', { name: 'Change' })
    fireEvent.click(within(change).getByRole('button', { name: 'Summarize' }))
    expect(await within(change).findByText('A summary.')).toBeTruthy()
  })

  it('draws the discussion summary inside the Discussion panel only', async () => {
    withComments([bobsComment])
    renderPanel()
    openDiscussion()
    const discussion = screen.getByRole('tabpanel', { name: 'Discussion, 1' })
    fireEvent.click(within(discussion).getByRole('button', { name: 'Summarize' }))
    expect(await within(discussion).findByText('A summary.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Change' }))
    const change = screen.getByRole('tabpanel', { name: 'Change' })
    expect(within(change).queryByText('A summary.')).toBeNull()
  })
})

describe('PrOverviewPanel — the discussion composer', () => {
  it('shows no composer until the Discussion tab is selected', () => {
    renderPanel()
    expect(screen.queryByPlaceholderText('Leave a comment…')).toBeNull()
    openDiscussion()
    expect(screen.getByPlaceholderText('Leave a comment…')).toBeTruthy()
  })

  it('counts the comments on the tab and lists them once it is selected', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [bobsComment],
      currentUserLogin: null,
    })
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'Discussion, 1' }))
    expect(screen.getByText('Looks off')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeTruthy()
  })

  it('offers no Summarize on a discussion with no comments', () => {
    renderPanel()
    openDiscussion()
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull()
  })
})

describe('PrOverviewPanel — replying and posting', () => {
  it('quotes a comment into the composer on Reply', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(),
      issueComments: [bobsComment],
      currentUserLogin: null,
    })
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'Discussion, 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    expect((screen.getByPlaceholderText('Leave a comment…') as HTMLTextAreaElement).value).toBe(
      '> Looks off\n\n'
    )
  })
})

describe('PrOverviewPanel — writing a comment', () => {
  it('shows Write and Preview, and an empty preview', () => {
    renderPanel()
    openDiscussion()
    fireEvent.click(screen.getByText('Preview'))
    expect(screen.getByText('Nothing to preview.')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Leave a comment…')).toBeNull()
  })

  it('posts a comment from the composer', async () => {
    const { githubAPI } = await import('../../src/api/github')
    renderPanel()
    openDiscussion()
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

describe('PrOverviewPanel — a branch that is behind', () => {
  const behind = { mergeStateStatus: 'behind' as const }

  it('says so and offers the update', () => {
    renderPanel(behind)
    expect(within(readiness()).getByText('Behind main')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update from main' })).toBeTruthy()
  })

  it('updates the branch, then refreshes the pull request', async () => {
    const { githubAPI } = await import('../../src/api/github')
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderPanel(behind, { onRefresh })
    fireEvent.click(screen.getByRole('button', { name: 'Update from main' }))
    await waitFor(() => {
      expect(githubAPI.prUpdateBranch).toHaveBeenCalledWith('/repo', 42)
      expect(onRefresh).toHaveBeenCalled()
    })
  })

  it('shows the error when GitHub refuses the update', async () => {
    const { githubAPI } = await import('../../src/api/github')
    vi.mocked(githubAPI.prUpdateBranch).mockResolvedValueOnce({ error: 'update failed' })
    renderPanel(behind)
    fireEvent.click(screen.getByRole('button', { name: 'Update from main' }))
    expect(await screen.findByText('update failed')).toBeTruthy()
  })
})

describe('PrOverviewPanel — a branch with conflicts', () => {
  it('offers no branch action on a clean branch', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: /Update from|Resolve conflicts/ })).toBeNull()
  })

  it('prepares a worktree, then opens the merge flow on it', async () => {
    const onStartMergeFlow = vi.fn()
    renderPanel({ mergeStateStatus: 'dirty' }, { onStartMergeFlow })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflicts' }))
    await waitFor(() => expect(onStartMergeFlow).toHaveBeenCalledWith('/tmp/worktree/branch'))
    expect(mockPreparePrWorktree).toHaveBeenCalledWith({
      repoRoot: '/repo',
      worktreePath: '/tmp/worktree/branch',
      headRefName: basePr.headRefName,
      baseRefName: basePr.baseRefName,
    })
  })
})

function withComments(issueComments: (typeof bobsComment)[]) {
  vi.mocked(usePrReviewStore).mockReturnValue({
    viewedFiles: new Set(),
    issueComments,
    currentUserLogin: null,
  })
}

const commentsNumbered = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    ...bobsComment,
    id: index + 1,
    body: `Comment ${index + 1}`,
  }))

function shownCommentBodies(): string[] {
  return screen
    .queryAllByTestId('rich-content')
    .map((element) => element.textContent ?? '')
    .filter((text) => text.startsWith('Comment '))
}

describe('PrOverviewPanel — the clamp fade', () => {
  const fades = (element: Element | null) =>
    element?.classList.contains('pr-overview-reading--overflows')

  it('draws no fade over text that fits', () => {
    withComments([bobsComment])
    renderPanel()
    expect(fades(screen.getByTestId('rich-content').parentElement)).toBe(false)
    openDiscussion()
    expect(fades(screen.getByText('Looks off').parentElement)).toBe(false)
  })

  it('fades text that overflows the clamp, and not once it is opened', async () => {
    const restore = stubDescriptionHeights(900, 300)
    try {
      renderPanel()
      const reading = screen.getByTestId('rich-content').parentElement
      expect(fades(reading)).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Show full description' }))
      expect(fades(reading)).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('PrOverviewPanel — earlier comments', () => {
  it('shows the last three of five comments, and the rest on request', () => {
    withComments(commentsNumbered(5))
    renderPanel()
    openDiscussion()
    expect(shownCommentBodies()).toEqual(['Comment 3', 'Comment 4', 'Comment 5'])
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 earlier comments' }))
    expect(shownCommentBodies()).toEqual([1, 2, 3, 4, 5].map((n) => `Comment ${n}`))
    expect(screen.queryByRole('button', { name: /earlier comment/ })).toBeNull()
  })

  it.each([0, 1, 3])('collapses nothing in a discussion of %i comments', (count) => {
    withComments(commentsNumbered(count))
    renderPanel()
    openDiscussion()
    expect(shownCommentBodies()).toHaveLength(count)
    expect(screen.queryByRole('button', { name: /earlier comment/ })).toBeNull()
  })

  it('names one earlier comment in the singular', () => {
    withComments(commentsNumbered(4))
    renderPanel()
    openDiscussion()
    expect(screen.getByRole('button', { name: 'Show 1 earlier comment' })).toBeTruthy()
  })
})

describe('PrOverviewPanel — clamping a comment', () => {
  it('clamps each comment body', () => {
    withComments(commentsNumbered(2))
    renderPanel()
    openDiscussion()
    const bodies = screen.getAllByText(/^Comment \d$/).map((element) => element.parentElement)
    expect(bodies.every((body) => body?.classList.contains('pr-overview-reading--clamped'))).toBe(
      true
    )
  })

  it('offers the full text of a long comment', () => {
    const restore = stubDescriptionHeights(900, 160)
    try {
      withComments([bobsComment])
      renderPanel()
      openDiscussion()
      fireEvent.click(screen.getByRole('button', { name: 'Show full comment' }))
      const body = screen.getByText('Looks off').parentElement
      expect(body?.classList.contains('pr-overview-reading--clamped')).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('PrOverviewPanel — a narrow pane', () => {
  it('moves the properties rail into a third tab', () => {
    pane.width = 760
    renderPanel()
    expect(screen.queryByRole('complementary', { name: 'Pull request details' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Properties' }))
    const panel = screen.getByRole('tabpanel', { name: 'Properties' })
    expect(within(panel).getByRole('heading', { name: 'Signals' })).toBeTruthy()
    expect(within(panel).getByRole('heading', { name: 'Details' })).toBeTruthy()
  })

  it('offers no Properties tab at 900px', () => {
    pane.width = 900
    renderPanel()
    expect(screen.queryByRole('tab', { name: 'Properties' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Pull request details' })).toBeTruthy()
  })
})

describe('PrOverviewPanel — a pane that widens', () => {
  it('goes back to Change when the pane widens on the Properties tab', () => {
    pane.width = 760
    const { rerender } = renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'Properties' }))
    pane.width = 1180
    rerender(
      <PrOverviewPanel
        repoRoot="/repo"
        pr={basePr}
        sessionStatus="not-started"
        onStartReview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('tabpanel', { name: 'Change' })).toBeTruthy()
  })
})
