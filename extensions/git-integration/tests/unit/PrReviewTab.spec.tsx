import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrReviewTab } from '../../src/components/pr-review/PrReviewTab'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import * as githubModule from '../../src/api/github'
import {
  useFetchFileMetrics,
  useLoadIssueComments,
  useLoadPrDetail,
  useLoadPrQueue,
} from '../../src/hooks/usePrReview'
import type { Chapter, PrChangedFile, PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../tests/support/fakes'

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    sessionGet: vi.fn(),
    sessionSet: vi.fn(),
    saveActiveReview: vi.fn(),
    removeActiveReview: vi.fn(),
    prCompare: vi.fn(),
  },
}))

vi.mock('../../src/hooks/usePrReview', () => ({
  useLoadPrQueue: vi.fn(),
  useLoadPrDetail: vi.fn(),
  useFetchFileMetrics: vi.fn(),
  useLoadIssueComments: vi.fn(),
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
    sinceInfo,
  }: {
    sinceInfo?: { commitCount: number } | null
    onClose: () => void
    onRefresh: () => void
    onShowOverview?: () => void
    onPopOut?: () => void
    onApproved?: () => void
  }) => (
    <div data-testid="pr-review-view">
      {sinceInfo && <p>{sinceInfo.commitCount} commits since the last look</p>}
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

const mockInvoke = vi.fn()
const mockOn = vi.fn()

beforeEach(() => {
  mockInvoke.mockResolvedValue({ ok: true })
  mockOn.mockReturnValue(() => {})
  vi.mocked(useLoadPrQueue).mockReturnValue(async () => {})
  vi.mocked(useLoadPrDetail).mockReturnValue(async () => {})
  vi.mocked(useFetchFileMetrics).mockReturnValue(async () => {})
  vi.mocked(useLoadIssueComments).mockReturnValue(async () => {})
  vi.mocked(githubModule.githubAPI.sessionGet).mockResolvedValue({ session: null })
  vi.mocked(githubModule.githubAPI.sessionSet).mockResolvedValue({})
  vi.mocked(githubModule.githubAPI.saveActiveReview).mockResolvedValue({ ok: true })
  vi.mocked(githubModule.githubAPI.removeActiveReview).mockResolvedValue({ ok: true })
  vi.mocked(githubModule.githubAPI.prCompare).mockResolvedValue({
    rewritten: false,
    commits: 0,
    files: [],
  })
  usePrReviewStore.getState().reset()
  Object.assign(globalThis, {
    electronAPI: {
      extensionBridge: {
        invoke: mockInvoke,
        on: mockOn,
      },
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

/** Opens the PR and waits for the overview, the open flow's last step; left to cleanup, after
 *  electronAPI was gone, the subscribing effect threw and broke React for the rest of the file. */
async function openPr() {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Open PR' }))
  await screen.findByTestId('pr-overview-panel')
}

/** PR 1's stored session under `key`, viewed a.ts at `headSHA`. */
function storeSessionAt(key: string, headSHA: string) {
  const session = {
    repoRoot: '/repo',
    prNumber: 1,
    headSHA,
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: ['a.ts'],
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    lastAccessedAt: '2025-01-01T00:00:00Z',
  }
  vi.mocked(githubModule.githubAPI.sessionGet).mockImplementation(async (sessionKey: string) =>
    sessionKey === key ? { session } : { session: null }
  )
}

/** Renders the tab and opens PR 1, whose detail loads at `headSHA`. */
async function openPrAtHead(headSHA: string) {
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

  it('shows the review, not the overview, for a PR that is already active', () => {
    usePrReviewStore.setState({
      activePr: partialFake<PrReviewDetail>({ number: 1, title: 'My PR' }),
    })
    render(<PrReviewTab repoRoot="/repo" />)
    expect(screen.getByTestId('pr-review-view')).toBeTruthy()
    expect(screen.queryByTestId('pr-overview-panel')).toBeNull()
  })
})

/** PR 1 open on its overview, with chapter c2 holding b.ts and the reader saved at c1/a.ts. */
async function showOverviewOfOpenPr() {
  usePrReviewStore.setState({
    activePr: partialFake<PrReviewDetail>({
      number: 1,
      title: 'My PR',
      chapters: [
        partialFake<Chapter>({ id: 'c2', files: [partialFake<PrChangedFile>({ path: 'b.ts' })] }),
      ],
    }),
    currentChapterId: 'c1',
    currentFilePath: 'a.ts',
  })
  const user = userEvent.setup()
  render(<PrReviewTab repoRoot="/repo" />)
  await user.click(screen.getByRole('button', { name: 'Show Overview' }))
  return user
}

describe('PrReviewTab — starting from the overview', () => {
  it('opens the review at the chapter picked in the review plan', async () => {
    const user = await showOverviewOfOpenPr()
    await user.click(screen.getByRole('button', { name: 'Start at chapter 2' }))
    const { currentChapterId, currentFilePath } = usePrReviewStore.getState()
    expect({ currentChapterId, currentFilePath }).toEqual({
      currentChapterId: 'c2',
      currentFilePath: 'b.ts',
    })
    expect(screen.getByTestId('pr-review-view')).toBeTruthy()
  })

  it('keeps the saved chapter when the review starts from the header button', async () => {
    const user = await showOverviewOfOpenPr()
    await user.click(screen.getByRole('button', { name: 'Start Review' }))
    const { currentChapterId, currentFilePath } = usePrReviewStore.getState()
    expect({ currentChapterId, currentFilePath }).toEqual({
      currentChapterId: 'c1',
      currentFilePath: 'a.ts',
    })
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
    render(<PrReviewTab repoRoot="/repo" />)
    expect(document.title).toBe('Code Reviews')

    act(() => {
      usePrReviewStore.setState({
        activePr: partialFake<PrReviewDetail>({ number: 214, title: 'Code review revamp' }),
      })
    })
    expect(document.title).toBe('#214 Code review revamp — Review')
  })

  it('leaves the title alone when embedded in the main window', () => {
    document.title = 'Git Integration'
    usePrReviewStore.setState({
      activePr: partialFake<PrReviewDetail>({ number: 214, title: 'Code review revamp' }),
    })
    render(<PrReviewTab repoRoot="/repo" />)
    expect(document.title).toBe('Git Integration')
  })
})

describe('PrReviewTab — pop out button', () => {
  it('calls extensionBridge.invoke with window:open-pr-review when pop out button is clicked', async () => {
    const user = userEvent.setup()
    render(<PrReviewTab repoRoot="/repo" />)
    await user.click(screen.getByTitle('Open in new window'))
    expect(mockInvoke).toHaveBeenCalledWith(
      'window:open-pr-review',
      expect.objectContaining({ repoRoot: '/repo' })
    )
  })
})

describe('PrReviewTab — includes prNumber and showOverview in popout payload when a PR is active', () => {
  it('includes prNumber and showOverview in popout payload when a PR is active', async () => {
    const user = userEvent.setup()
    usePrReviewStore.setState({
      activePr: partialFake<PrReviewDetail>({ number: 42, title: 'Active PR', headSHA: 'sha123' }),
    })
    render(<PrReviewTab repoRoot="/repo" />)
    // activePr is set + showOverview defaults to false → PrReviewView renders
    await user.click(screen.getByTitle('Open in focused window'))
    expect(mockInvoke).toHaveBeenCalledWith(
      'window:open-pr-review',
      expect.objectContaining({ repoRoot: '/repo', prNumber: '42', showOverview: 'false' })
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
    usePrReviewStore.setState({ activePr: pr7 })
    const user = userEvent.setup()
    render(<PrReviewTab repoRoot="/repo" />)
    await user.click(screen.getByRole('button', { name: 'Approved' }))
    expect(close).toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith('window:review-submitted', {})
    close.mockRestore()
  })
})

describe('PrReviewTab (continued) — after an approval — returns the docked panel to its queue', () => {
  it('returns the docked panel to its queue', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    usePrReviewStore.setState({ activePr: pr7 })
    const user = userEvent.setup()
    render(<PrReviewTab repoRoot="/repo" />)
    await user.click(screen.getByRole('button', { name: 'Approved' }))
    expect(await screen.findByTestId('review-queue')).not.toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith('window:review-submitted', {})
    expect(close).not.toHaveBeenCalled()
    close.mockRestore()
  })
})

describe('PrReviewTab — restores a legacy session when the v2 key has none', () => {
  it('restores the viewed files of the session stored under the legacy per-head key', async () => {
    storeSessionAt('/repo:::1:::headA', 'headA')
    await openPrAtHead('headA')
    expect([...usePrReviewStore.getState().viewedFiles]).toEqual(['a.ts'])
  })
})

describe('PrReviewTab — reconciles the stored session against the new head via prCompare', () => {
  it('reconciles the stored session against the new head via prCompare', async () => {
    storeSessionAt('/repo:::1', 'oldSha')
    // PrCompareResult lacks the `status` the channel sends (PrReviewTab reads it as HeadCompare).
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
    const { viewedFiles, changedSince, newSinceLook } = usePrReviewStore.getState()
    expect([...viewedFiles]).toEqual([])
    expect([...changedSince]).toEqual(['a.ts'])
    expect([...newSinceLook]).toEqual(['scripts/e2e-burn-in.ts'])
  })
})

describe('PrReviewTab — what changed since the last look', () => {
  it('hands the review the number of commits pushed since the stored head', async () => {
    storeSessionAt('/repo:::1', 'oldSha')
    vi.mocked(githubModule.githubAPI.prCompare).mockResolvedValue({
      rewritten: false,
      commits: 1,
      files: [{ path: 'a.ts', status: 'modified' }],
    } as never)
    await openPrAtHead('newSha')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start Review' }))
    expect(await screen.findByText('1 commits since the last look')).toBeTruthy()
  })
})

describe('PrReviewTab — reconciles with all when the compare says history was rewritten', () => {
  it('marks every viewed file changed when the compare says history was rewritten', async () => {
    storeSessionAt('/repo:::1', 'oldSha')
    vi.mocked(githubModule.githubAPI.prCompare).mockResolvedValue({
      rewritten: true,
      commits: 5,
      files: [],
    })
    await openPrAtHead('newSha')
    const { viewedFiles, changedSince, historyRewritten } = usePrReviewStore.getState()
    expect([...viewedFiles]).toEqual([])
    expect([...changedSince]).toEqual(['a.ts'])
    expect(historyRewritten).toBe(true)
  })
})

describe('PrReviewTab — a review submitted in another window', () => {
  it('reloads the queue, so the pull request shows its new approval and review state', async () => {
    const loadQueue = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useLoadPrQueue).mockReturnValue(loadQueue)
    render(<PrReviewTab repoRoot="/repo" />)
    const onReviewsChanged = mockOn.mock.calls.find(([channel]) => channel === 'reviews:changed')

    expect(onReviewsChanged).toBeDefined()
    loadQueue.mockClear()
    onReviewsChanged![1]({})
    expect(loadQueue).toHaveBeenCalledTimes(1)
  })
})
