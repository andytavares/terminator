import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrReviewTab } from '../../src/components/pr-review/PrReviewTab'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import * as githubModule from '../../src/api/github'
import type { Chapter, PrChangedFile, PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../tests/support/fakes'

vi.mock('../../src/stores/pr-review.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/stores/pr-review.store')>()
  return {
    ...actual,
    usePrReviewStore: vi.fn(),
  }
})

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    sessionGet: vi.fn().mockResolvedValue({ session: null }),
    sessionSet: vi.fn().mockResolvedValue({}),
    saveActiveReview: vi.fn().mockResolvedValue({ ok: true }),
    removeActiveReview: vi.fn().mockResolvedValue({ ok: true }),
    prCompare: vi.fn().mockResolvedValue({ rewritten: false, commits: 0, files: [] }),
  },
}))

vi.mock('../../src/hooks/usePrReview', () => ({
  useLoadPrQueue: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useLoadPrDetail: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useFetchFileMetrics: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useLoadIssueComments: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
}))

vi.mock('../../src/components/pr-review/ReviewQueue', () => ({
  ReviewQueue: ({
    onOpenPr,
    onRefresh,
    onLoadMore,
  }: {
    onOpenPr: (pr: { number: number; title: string }) => void
    onRefresh: (opts: { search: string }) => void
    onLoadMore: () => void
  }) => (
    <div data-testid="review-queue">
      <button onClick={() => onOpenPr({ number: 1, title: 'Test PR' })}>Open PR</button>
      <button onClick={() => onRefresh({ search: 'test' })}>Refresh</button>
      <button onClick={() => onLoadMore()}>Load More</button>
    </div>
  ),
}))

vi.mock('../../src/components/pr-review/PrReviewView', () => ({
  PrReviewView: ({
    onClose,
    onRefresh,
    onShowOverview,
    onPopOut,
    onApproved,
  }: {
    onClose: () => void
    onRefresh: () => void
    onShowOverview?: () => void
    onPopOut?: () => void
    onApproved?: () => void
  }) => (
    <div data-testid="pr-review-view">
      <button onClick={onClose}>Close PR</button>
      {onApproved && <button onClick={onApproved}>Approved</button>}
      <button onClick={onRefresh}>Refresh PR</button>
      {onShowOverview && <button onClick={onShowOverview}>Show Overview</button>}
      {onPopOut && (
        <button onClick={onPopOut} title="Open in focused window">
          Pop out
        </button>
      )}
    </div>
  ),
}))

vi.mock('../../src/components/pr-review/PrOverviewPanel', () => ({
  PrOverviewPanel: ({
    onStartReview,
    onClose,
  }: {
    onStartReview: (chapterId?: string) => void
    onClose: () => void
  }) => (
    <div data-testid="pr-overview-panel">
      <button onClick={() => onStartReview()}>Start Review</button>
      <button onClick={() => onStartReview('c2')}>Start at chapter 2</button>
      <button onClick={onClose}>Close Overview</button>
    </div>
  ),
}))

const mockSetActivePr = vi.fn()
const mockInitSession = vi.fn()
const mockReconcileHead = vi.fn()
const mockReset = vi.fn()
const mockMarkPrInProgress = vi.fn()
const mockDismissPr = vi.fn()
const mockSetPaused = vi.fn()
const mockSetCurrentChapter = vi.fn()
const mockSetCurrentFile = vi.fn()

const defaultStoreState = {
  activePr: null,
  setActivePr: mockSetActivePr,
  initSession: mockInitSession,
  reconcileHead: mockReconcileHead,
  reset: mockReset,
  markPrInProgress: mockMarkPrInProgress,
  dismissPr: mockDismissPr,
  setPaused: mockSetPaused,
  setCurrentChapter: mockSetCurrentChapter,
  setCurrentFile: mockSetCurrentFile,
  nextPrCursor: null,
  viewedFiles: new Set<string>(),
  currentChapterId: null,
  currentFilePath: null,
  fileOrderOverrides: {},
  scrollPosition: null,
}

const mockInvoke = vi.fn().mockResolvedValue({ ok: true })
const mockOn = vi.fn().mockReturnValue(() => {})

beforeEach(() => {
  vi.clearAllMocks()
  ;(githubModule.githubAPI.sessionGet as ReturnType<typeof vi.fn>).mockResolvedValue({
    session: null,
  })
  ;(githubModule.githubAPI.sessionSet as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(githubModule.githubAPI.saveActiveReview as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
  })
  Object.assign(globalThis, {
    electronAPI: {
      extensionBridge: {
        invoke: mockInvoke,
        on: mockOn,
      },
    },
  })
  vi.mocked(usePrReviewStore).mockReturnValue(defaultStoreState)
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

/** Opens the PR inside an async act, which returns once the open flow's awaits and their renders
 *  ran (https://react.dev/reference/react/act); left to cleanup, after electronAPI was gone, the
 *  subscribing effect threw on a busy machine and broke React for the rest of the file. */
async function openPr() {
  await act(async () => {
    fireEvent.click(screen.getByText('Open PR'))
  })
}

/** PR 1's stored v2 session, viewed a.ts at oldSha. */
function storeSessionAtOldSha() {
  const session = {
    repoRoot: '/repo',
    prNumber: 1,
    headSHA: 'oldSha',
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: ['a.ts'],
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    lastAccessedAt: '2025-01-01T00:00:00Z',
  }
  vi.mocked(githubModule.githubAPI.sessionGet).mockImplementation(async (key: string) =>
    key === '/repo:::1' ? { session } : { session: null }
  )
}

/** Renders the tab and opens PR 1, whose detail loads at `headSHA`. */
async function openPrAtHead(headSHA: string) {
  const { useLoadPrDetail } = await import('../../src/hooks/usePrReview')
  vi.mocked(useLoadPrDetail).mockReturnValue(async (_n, onSuccess) =>
    onSuccess(partialFake<PrReviewDetail>({ number: 1, headSHA }))
  )
  render(<PrReviewTab repoRoot="/repo" />)
  await openPr()
}

describe('PrReviewTab', () => {
  it('shows empty message when repoRoot is null', () => {
    render(<PrReviewTab repoRoot={null} />)
    expect(screen.getByText('Open a project to view pull requests.')).toBeTruthy()
  })

  it('renders ReviewQueue when repoRoot is provided and no active PR', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    expect(screen.getByTestId('review-queue')).toBeTruthy()
  })

  it('renders PrOverviewPanel when activePr is set', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: partialFake<PrReviewDetail>({ number: 1, title: 'My PR' }),
    })
    // showOverview starts false; we need to simulate opening a PR to get it to true
    // Since activePr is pre-set here, showOverview stays false → PrReviewView shows
    render(<PrReviewTab repoRoot="/repo" />)
    // With activePr set and showOverview=false, PrReviewView should render
    expect(screen.getByTestId('pr-review-view')).toBeTruthy()
  })
})

describe('PrReviewTab — starting from the overview', () => {
  function showOverviewOfOpenPr() {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: partialFake<PrReviewDetail>({
        number: 1,
        title: 'My PR',
        chapters: [
          partialFake<Chapter>({ id: 'c2', files: [partialFake<PrChangedFile>({ path: 'b.ts' })] }),
        ],
      }),
    })
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Show Overview'))
  }

  it('opens the review at the chapter picked in the review plan', () => {
    showOverviewOfOpenPr()
    fireEvent.click(screen.getByText('Start at chapter 2'))
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('c2')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('b.ts')
    expect(screen.getByTestId('pr-review-view')).toBeTruthy()
  })

  it('keeps the saved chapter when the review starts from the header button', () => {
    showOverviewOfOpenPr()
    fireEvent.click(screen.getByText('Start Review'))
    expect(mockSetCurrentChapter).not.toHaveBeenCalled()
    expect(mockSetCurrentFile).not.toHaveBeenCalled()
    expect(screen.getByTestId('pr-review-view')).toBeTruthy()
  })
})

describe('PrReviewTab (continued) — window title', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
    document.title = ''
  })

  it('names the pop-out window after the PR it shows, so the Window menu can list it', () => {
    window.history.replaceState(null, '', '/?view=pr-review')
    const { rerender } = render(<PrReviewTab repoRoot="/repo" />)
    expect(document.title).toBe('Code Reviews')

    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: partialFake<PrReviewDetail>({ number: 214, title: 'Code review revamp' }),
    })
    rerender(<PrReviewTab repoRoot="/repo" />)
    expect(document.title).toBe('#214 Code review revamp — Review')
  })

  it('leaves the title alone when embedded in the main window', () => {
    document.title = 'Git Integration'
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: partialFake<PrReviewDetail>({ number: 214, title: 'Code review revamp' }),
    })
    render(<PrReviewTab repoRoot="/repo" />)
    expect(document.title).toBe('Git Integration')
  })
})

describe('PrReviewTab — shows pop out button', () => {
  it('shows pop out button', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    expect(screen.getByTitle('Open in new window')).toBeTruthy()
  })

  it('calls extensionBridge.invoke with window:open-pr-review when pop out button is clicked', () => {
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByTitle('Open in new window'))
    expect(mockInvoke).toHaveBeenCalledWith(
      'window:open-pr-review',
      expect.objectContaining({ repoRoot: '/repo' })
    )
  })
})

describe('PrReviewTab — includes prNumber and showOverview in popout payload when a PR is active', () => {
  it('includes prNumber and showOverview in popout payload when a PR is active', async () => {
    const activePr = partialFake<PrReviewDetail>({
      number: 42,
      title: 'Active PR',
      headSHA: 'sha123',
    })
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr,
    })
    render(<PrReviewTab repoRoot="/repo" />)
    // activePr is set + showOverview defaults to false → PrReviewView renders
    fireEvent.click(screen.getByTitle('Open in focused window'))
    expect(mockInvoke).toHaveBeenCalledWith(
      'window:open-pr-review',
      expect.objectContaining({ repoRoot: '/repo', prNumber: '42', showOverview: 'false' })
    )
  })
})

describe('PrReviewTab — closes PR view and persists paused session when onClose is called', () => {
  it('closes PR view and persists paused session when onClose is called', async () => {
    const activePr = partialFake<PrReviewDetail>({ number: 1, title: 'My PR', headSHA: 'abc123' })
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr,
    })
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Close PR'))
    // Allow async handleClosePr to settle
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSetActivePr).toHaveBeenCalledWith(null)
    expect(mockReset).toHaveBeenCalled()
    expect(mockSetPaused).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: 1, headSHA: 'abc123' },
      expect.any(String)
    )
  })
})

/** PR 7, open in the tab. */
const pr7 = partialFake<PrReviewDetail>({ number: 7, title: 'My PR', headSHA: 'abc123' })

describe('PrReviewTab (continued) — after an approval', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('closes the pop-out so the review list behind it shows, and tells the list to reload', async () => {
    window.history.replaceState(null, '', '/?view=pr-review')
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: pr7,
    })
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Approved'))
    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(mockInvoke).toHaveBeenCalledWith('window:review-submitted', {})
    close.mockRestore()
  })
})

describe('PrReviewTab (continued) — after an approval — returns the docked panel to its queue', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('returns the docked panel to its queue', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      activePr: pr7,
    })
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Approved'))
    await waitFor(() => expect(mockSetActivePr).toHaveBeenCalledWith(null))
    expect(mockInvoke).toHaveBeenCalledWith('window:review-submitted', {})
    expect(close).not.toHaveBeenCalled()
    close.mockRestore()
  })
})

describe('PrReviewTab — reads the v2 session key before falling back to the legacy key', () => {
  it('reads the v2 session key before falling back to the legacy key', async () => {
    ;(githubModule.githubAPI.sessionGet as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => (key === '/repo:::1' ? { session: null } : { session: null })
    )
    await openPrAtHead('headA')
    expect(githubModule.githubAPI.sessionGet).toHaveBeenCalledWith('/repo:::1')
    expect(githubModule.githubAPI.sessionGet).toHaveBeenCalledWith('/repo:::1:::headA')
  })
})

describe('PrReviewTab — reconciles the stored session against the new head via prCompare', () => {
  it('reconciles the stored session against the new head via prCompare', async () => {
    storeSessionAtOldSha()
    ;(githubModule.githubAPI.prCompare as ReturnType<typeof vi.fn>).mockResolvedValue({
      rewritten: false,
      commits: 3,
      files: [
        { path: 'a.ts', status: 'modified' },
        { path: 'scripts/e2e-burn-in.ts', status: 'added' },
      ],
    })
    await openPrAtHead('newSha')
    expect(githubModule.githubAPI.prCompare).toHaveBeenCalledWith('/repo', 'oldSha', 'newSha')
    expect(mockReconcileHead).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: 1, headSHA: 'newSha' },
      ['a.ts', 'scripts/e2e-burn-in.ts'],
      ['scripts/e2e-burn-in.ts']
    )
  })
})

describe('PrReviewTab — reconciles with all when the compare says history was rewritten', () => {
  it('reconciles with "all" when the compare says history was rewritten', async () => {
    storeSessionAtOldSha()
    ;(githubModule.githubAPI.prCompare as ReturnType<typeof vi.fn>).mockResolvedValue({
      rewritten: true,
      commits: 5,
      files: [],
    })
    await openPrAtHead('newSha')
    expect(mockReconcileHead).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: 1, headSHA: 'newSha' },
      'all',
      []
    )
  })
})

describe('PrReviewTab — a review submitted in another window', () => {
  it('reloads the queue, so the pull request shows its new approval and review state', async () => {
    const loadQueue = vi.fn().mockResolvedValue(undefined)
    const { useLoadPrQueue } = await import('../../src/hooks/usePrReview')
    vi.mocked(useLoadPrQueue).mockReturnValue(loadQueue)
    render(<PrReviewTab repoRoot="/repo" />)
    const onReviewsChanged = mockOn.mock.calls.find(([channel]) => channel === 'reviews:changed')

    expect(onReviewsChanged).toBeDefined()
    loadQueue.mockClear()
    onReviewsChanged![1]({})
    expect(loadQueue).toHaveBeenCalledTimes(1)
  })
})
