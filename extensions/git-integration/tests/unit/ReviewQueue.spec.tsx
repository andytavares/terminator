import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewQueue } from '../../src/components/pr-review/ReviewQueue'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
import type { ReviewQueuePR } from '../../src/schemas/pr-review.schema'
import type { OpenStatus } from '../../src/review/open-status'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

const PASSING_DOTS: ReviewQueuePR['signalDots'] = {
  tests: 'pass',
  coverage: 'pass',
  ci: 'pass',
  lint: 'pass',
  churn: 'pass',
  blast: 'pass',
}

function makePr(overrides: Partial<ReviewQueuePR> = {}): ReviewQueuePR {
  return {
    number: 1,
    title: 'Fix bug',
    author: 'alice',
    authorAvatarUrl: '',
    openedAt: new Date().toISOString(),
    fileCount: 3,
    additions: 20,
    deletions: 5,
    isDraft: false,
    state: 'open',
    ciStatus: 'passing',
    headRefName: 'feat',
    baseRefName: 'main',
    riskLevel: 'low',
    estimatedMinutes: 10,
    sessionStatus: 'not-started',
    signalDots: PASSING_DOTS,
    approvalCount: 0,
    approvedBy: [],
    requestedReviewers: [],
    assigneeLogins: [],
    viewedFileCount: 0,
    mergeStateStatus: 'unknown',
    ...overrides,
  }
}

const defaultStoreState = {
  prQueue: [],
  queueLoading: false,
  loadingMorePrs: false,
  queueError: null,
  rateLimitState: null,
  hasMorePrs: false,
  totalPrCount: null,
  currentUserLogin: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  useReviewUiStore.setState({ queueSort: 'newest' })
  vi.mocked(usePrReviewStore).mockReturnValue(defaultStoreState)
})

const defaultProps = {
  repoRoot: '/repo',
  onOpenPr: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onDismissPr: vi.fn().mockResolvedValue(undefined),
}

describe('ReviewQueue', () => {
  it('shows loading state when queueLoading is true', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      queueLoading: true,
    })
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Loading pull requests…')).toBeTruthy()
  })

  it('shows empty state when queue is empty', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('No open pull requests.')).toBeTruthy()
  })
})

describe('ReviewQueue — summarises the queue in one line instead of four tiles', () => {
  it('summarises the queue in one line instead of four tiles', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ number: 1, riskLevel: 'high' })],
      totalPrCount: 1,
    })
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/waiting on you/)).toBeTruthy()
    expect(screen.getByText(/of reading/)).toBeTruthy()
    // Two of the old tile labels told the reader what to do rather than naming
    // a metric; the grouping below already does that.
    expect(screen.queryByText('High risk — read these first')).toBeNull()
  })

  it('renders PR rows when queue has PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ number: 42, title: 'Add feature' })],
    })
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Add feature')).toBeTruthy()
    expect(screen.getByText('#42')).toBeTruthy()
  })
})

describe('ReviewQueue — calls onOpenPr when PR row is clicked', () => {
  it('calls onOpenPr when PR row is clicked', async () => {
    const user = userEvent.setup()
    const pr = makePr({ number: 7, title: 'My PR' })
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [pr],
    })
    const onOpenPr = vi.fn()
    render(<ReviewQueue {...defaultProps} onOpenPr={onOpenPr} />)
    await user.click(screen.getByText('My PR'))
    expect(onOpenPr).toHaveBeenCalledWith(pr)
  })

  it('calls onRefresh when refresh button is clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(<ReviewQueue {...defaultProps} onRefresh={onRefresh} />)
    await user.click(screen.getByRole('button', { name: 'Refresh pull requests' }))
    expect(onRefresh).toHaveBeenCalled()
  })
})

describe('ReviewQueue — load failures', () => {
  it('shows error state when queueError is set', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      queueError: 'Network failure',
    })
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/Failed to load queue: Network failure/)).toBeTruthy()
  })

  it('shows rate limit banner when rateLimitState is set', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      rateLimitState: { resetAt: Date.now() + 60000 },
    })
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/GitHub API rate limit reached/)).toBeTruthy()
  })
})

describe('ReviewQueue — says a page is on its way rather than asking for a click', () => {
  it('says a page is on its way rather than asking for a click', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      hasMorePrs: true,
      loadingMorePrs: true,
      prQueue: [makePr()],
    })
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Loading the rest…')).toBeTruthy()
    expect(screen.queryByText('Load more pull requests')).toBeNull()
  })
})

describe('ReviewQueue — says nothing about medium or low risk', () => {
  it('says nothing about medium or low risk', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [
        makePr({ riskLevel: 'medium', number: 1, title: 'Medium PR' }),
        makePr({ riskLevel: 'low', number: 2, title: 'Low PR' }),
      ],
    })
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.queryByText(/risk/i)).toBeNull()
  })
})

describe('ReviewQueue — shows Resume action for paused PRs', () => {
  it('shows Resume action for paused PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [
        makePr({
          sessionStatus: 'paused',
          resumeChapter: 2,
          resumeChapterTotal: 3,
          number: 12,
          title: 'Paused PR',
        }),
      ],
    })
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getAllByText('Resume').length).toBeGreaterThan(0)
  })
})

function renderMany(prs: ReviewQueuePR[], extra: Record<string, unknown> = {}) {
  vi.mocked(usePrReviewStore).mockReturnValue({
    ...defaultStoreState,
    prQueue: prs,
    ...extra,
  })
  return render(<ReviewQueue {...defaultProps} />)
}

/** Matches the one element whose whole text, across its child elements, is `text`. */
const wholeText = (text: string) => (_: string, node: Element | null) => node?.textContent === text

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

/** The rows' names, "#7 Title", top to bottom. */
const titles = () =>
  screen.getAllByRole('group', { name: /^#\d+ / }).map((row) => row.getAttribute('aria-label'))

/** The second line of the only row. */
const metaLine = () => screen.getByTestId('pr-meta').textContent

describe('ReviewQueue (continued) — one list, two lines per row', () => {
  it('has no open/closed toggle', () => {
    renderMany([])
    expect(screen.queryByRole('button', { name: /open only|open \+ closed/i })).toBeNull()
    expect(screen.queryByText('Open only')).toBeNull()
  })

  it('tells the search how to find merged pull requests', () => {
    renderMany([])
    expect(screen.getByPlaceholderText('Search open PRs · is:merged for merged')).toBeTruthy()
  })

  it.each([
    ['merged', 'Merged'],
    ['closed', 'Closed'],
  ] as const)('shows the state first on the second line of a %s row', (state, label) => {
    renderMany([makePr({ state, title: 'Finished' })])
    expect(metaLine()!.startsWith(label)).toBe(true)
  })
})

describe('ReviewQueue (continued) — one list, two lines per row — has one heading with the total, and none of the old groups', () => {
  it('has one heading with the total, and none of the old groups', () => {
    renderMany([makePr({ number: 1 }), makePr({ number: 2, riskLevel: 'high' })], {
      totalPrCount: 47,
    })
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toContain('Open pull requests')
    expect(headings[0].textContent).toContain('47')
    const oldGroups = [
      'In progress',
      'Needs your review',
      'Read these first',
      'Quick wins',
      'Larger reviews',
    ]
    expect(oldGroups.filter((old) => screen.queryByText(old))).toEqual([])
    expect(screen.queryByText(/Open more than/)).toBeNull()
  })
})

describe('ReviewQueue (continued) — one list, two lines per row — sorts newest first by default', () => {
  it('sorts newest first by default', () => {
    renderMany([
      makePr({ number: 1, title: 'Older', openedAt: days(9) }),
      makePr({ number: 2, title: 'Newer', openedAt: days(1) }),
    ])
    expect(titles()[0]).toContain('Newer')
    expect((screen.getByRole('combobox', { name: 'Sort' }) as HTMLSelectElement).value).toBe(
      'newest'
    )
  })

  it('offers the three sorts by name', () => {
    renderMany([])
    const select = screen.getByRole('combobox', { name: 'Sort' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Newest first', 'Closest to merging', 'Started by you'])
  })
})

describe('ReviewQueue (continued) — one list, two lines per row — puts approved, passing pull requests first under Closest to merging', () => {
  it('puts approved, passing pull requests first under Closest to merging', async () => {
    const user = userEvent.setup()
    renderMany([
      makePr({ number: 1, title: 'Waiting', openedAt: days(9) }),
      makePr({
        number: 2,
        title: 'Ready',
        openedAt: days(1),
        approvalCount: 1,
        approvedBy: ['bo'],
      }),
    ])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'closest')
    expect(titles()[0]).toContain('Ready')
    expect(useReviewUiStore.getState().queueSort).toBe('closest')
  })
})

describe('ReviewQueue (continued) — one list, two lines per row — puts a paused pull request first under Started by you', () => {
  it('puts a paused pull request first under Started by you', async () => {
    const user = userEvent.setup()
    renderMany([
      makePr({ number: 1, title: 'Untouched', openedAt: days(9) }),
      makePr({ number: 2, title: 'Paused one', openedAt: days(1), sessionStatus: 'paused' }),
    ])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'started')
    expect(titles()[0]).toContain('Paused one')
  })
})

describe('ReviewQueue (continued) — one list, two lines per row — lays the second line out as attention states only', () => {
  it('lays the second line out as attention states only', () => {
    renderMany(
      [
        makePr({
          number: 212,
          title: 'ci: split shards',
          openedAt: days(139),
          isDraft: true,
          mergeStateStatus: 'dirty',
          approvalCount: 2,
          approvedBy: ['a', 'b'],
          riskLevel: 'high',
          ciStatus: 'failing',
          requestedReviewers: ['me'],
          sessionStatus: 'in-progress',
          viewedFileCount: 1,
          fileCount: 3,
        }),
      ],
      { currentUserLogin: 'me' }
    )
    expect(metaLine()).toBe(
      'Draft · Conflicts · alice · 139d · 2 approved · High risk · CI failing · Your review requested · 1 of 3 viewed'
    )
  })
})

describe('ReviewQueue (continued) — one list, two lines per row — leaves a quiet row with only the author and age', () => {
  it('leaves a quiet row with only the author and age', () => {
    renderMany([makePr({ openedAt: days(2) })])
    expect(metaLine()).toBe('alice · 2d')
  })

  it('shows the size and the reading time in the right column, with no risk chip', () => {
    renderMany([makePr({ additions: 1234, deletions: 3, fileCount: 1, estimatedMinutes: 7 })])
    const row = screen.getByRole('group', { name: /^#\d+ / })
    expect(within(row).getByText(wholeText('+1,234 −3 · 1 file'))).toBeTruthy()
    expect(within(row).getByText('~7 min')).toBeTruthy()
  })

  it('opens a row on Enter', async () => {
    const user = userEvent.setup()
    const pr = makePr({ title: 'Keyboard' })
    const onOpenPr = vi.fn()
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [pr],
    })
    render(<ReviewQueue {...defaultProps} onOpenPr={onOpenPr} />)
    const row = screen.getByRole('group', { name: '#1 Keyboard' })
    row.focus()
    expect(row.matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(onOpenPr).toHaveBeenCalledWith(pr)
  })
})

describe('ReviewQueue (continued) — one list, two lines per row — colours additions green and removals red', () => {
  it('colours additions green and removals red', () => {
    renderMany([makePr({ additions: 1234, deletions: 3 })])
    expect(screen.getByText('+1,234').className).toBe('rd-add')
    expect(screen.getByText('−3').className).toBe('rd-del')
  })

  it('names conflicts in the second line as text, with no icon', () => {
    renderMany([makePr({ mergeStateStatus: 'dirty' })])
    expect(within(screen.getByTestId('pr-meta')).getByText('Conflicts')).toBeTruthy()
    expect(screen.getByRole('group', { name: /^#\d+ / }).innerHTML).not.toContain('<svg')
  })
})

/** The queue with PRs 7 and 8, PR 7 in `openStatus`. */
function renderWithOpenStatus(openStatus: OpenStatus, repoRoot = '/repo') {
  vi.mocked(usePrReviewStore).mockReturnValue({
    ...defaultStoreState,
    prQueue: [makePr({ number: 7, title: 'Opening one' }), makePr({ number: 8, title: 'Other' })],
  })
  const onOpenPr = vi.fn()
  render(
    <ReviewQueue
      {...defaultProps}
      repoRoot={repoRoot}
      openStatus={openStatus}
      onOpenPr={onOpenPr}
    />
  )
  return onOpenPr
}

describe('ReviewQueue — a pull request that is opening', () => {
  it('shows its row as busy, with its action disabled and reading Opening…', () => {
    renderWithOpenStatus({ prNumber: 7, state: 'opening' })
    const row = screen.getByRole('group', { name: '#7 Opening one' })
    expect(row.getAttribute('aria-busy')).toBe('true')
    expect(within(row).getByRole('button', { name: 'Opening…' })).toHaveProperty('disabled', true)
  })

  it('does not open it again when its row is clicked', async () => {
    const onOpenPr = renderWithOpenStatus({ prNumber: 7, state: 'opening' })
    await userEvent.setup().click(screen.getByText('Opening one'))
    expect(onOpenPr).not.toHaveBeenCalled()
  })

  it('leaves the other rows clickable', async () => {
    const onOpenPr = renderWithOpenStatus({ prNumber: 7, state: 'opening' })
    const other = screen.getByRole('group', { name: '#8 Other' })
    await userEvent.setup().click(within(other).getByRole('button', { name: 'Review' }))
    expect(onOpenPr).toHaveBeenCalledWith(expect.objectContaining({ number: 8 }))
  })
})

describe('ReviewQueue — a pull request that did not open', () => {
  it('opens it on GitHub from a gh:owner/name repository', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('electronAPI', { shell: { openExternal } })
    renderWithOpenStatus({ prNumber: 7, state: 'failed', message: 'HTTP 502' }, 'gh:acme/app')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open on GitHub' }))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/acme/app/pull/7')
  })

  it('offers no GitHub link for a local checkout, whose address it does not know', () => {
    renderWithOpenStatus({ prNumber: 7, state: 'failed', message: 'HTTP 502' })
    expect(screen.getByRole('alert').textContent).toContain('Could not open #7.')
    expect(screen.queryByRole('button', { name: 'Open on GitHub' })).toBeNull()
  })
})
