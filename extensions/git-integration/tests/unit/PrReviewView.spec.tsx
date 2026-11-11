import React from 'react'
import { describe, it, beforeAll, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePrReviewStore, type PrReviewStore } from '../../src/stores/pr-review.store'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
import { PrReviewDetailSchema } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    sessionSet: vi.fn().mockResolvedValue({ ok: true }),
    filesViewedSet: vi.fn().mockResolvedValue({ ok: true }),
    fileViewedSet: vi.fn().mockResolvedValue({ ok: true }),
  },
}))
vi.mock('../../src/hooks/usePrReview', () => ({ useLoadInlineComments: vi.fn(() => vi.fn()) }))
vi.mock('../../src/components/pr-review/ReviewDiffPane', () => ({
  ReviewDiffPane: ({
    file,
    band,
    active,
    onPrevFile,
    onNextFile,
  }: {
    file: { path: string }
    band: string
    active: boolean
    onPrevFile: () => void
    onNextFile: () => void
  }) => (
    <div
      data-testid="review-diff-pane"
      data-path={file.path}
      data-band={band}
      data-active={String(active)}
    >
      {active && <button onClick={onPrevFile}>PrevFile</button>}
      {active && <button onClick={onNextFile}>NextFile</button>}
    </div>
  ),
}))
vi.mock('../../src/components/pr-review/AgentPanel', () => ({
  AgentPanel: () => <div data-testid="agent-panel" />,
}))
vi.mock('../../src/hooks/useAgentRuns', () => ({ useAgentRuns: vi.fn() }))

const mockFile = {
  path: 'src/foo.ts',
  changeType: 'modified' as const,
  additions: 5,
  deletions: 2,
  isBinary: false,
  whyHere: 'changed',
  churn90d: null,
}

const mockChapter = {
  id: 'ch-1',
  name: 'Chapter 1',
  status: 'not-started' as const,
  files: [mockFile],
}

// Parsed as the review channel's answer is, so the schema's defaults are filled in.
const mockPr = PrReviewDetailSchema.parse({
  number: 1,
  title: 'PR',
  body: '',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: '2025-01-01T00:00:00Z',
  headRefName: 'feature',
  baseRefName: 'main',
  headSHA: 'abc',
  ciStatus: 'passing' as const,
  lintStatus: 'pass' as const,
  chapters: [mockChapter],
})

const mockClose = vi.fn()
const mockRefresh = vi.fn().mockResolvedValue(undefined)

/** The paths of the sections the fake IntersectionObserver reports near the viewport; null for all. */
let nearPaths: string[] | null = null

/** happy-dom has no layout, so its IntersectionObserver never reports an entry. This one reports
 *  each observed section near the viewport when `nearPaths` lists it. */
class NearViewportObserver {
  constructor(private readonly report: IntersectionObserverCallback) {}
  observe(target: HTMLElement) {
    const path = target.dataset.reviewPath!
    const isIntersecting = nearPaths === null || nearPaths.includes(path)
    this.report([{ target, isIntersecting } as unknown as IntersectionObserverEntry], this as never)
  }
  disconnect() {}
}

beforeEach(() => {
  nearPaths = null
  vi.stubGlobal('IntersectionObserver', NearViewportObserver)
  vi.clearAllMocks()
  usePrReviewStore.getState().reset()
  localStorage.clear()
  useReviewUiStore.setState({ laterHunks: {}, revisitHunk: null, fileHunks: {} })
})

/** Seeds the real review store, renders the view on `mockPr` with `prOverrides`, and returns a
 *  user-event instance to drive it. */
async function renderView(
  prOverrides: Record<string, unknown> = {},
  storeOverrides: Partial<PrReviewStore> = {}
) {
  const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
  usePrReviewStore.setState(storeOverrides)
  const user = userEvent.setup()
  const rendered = render(
    <PrReviewView
      repoRoot="/repo"
      pr={{ ...mockPr, ...prOverrides }}
      onClose={mockClose}
      onRefresh={mockRefresh}
    />
  )
  return { user, ...rendered }
}

/** The reader's position in the real store. */
function position() {
  const { currentChapterId, currentFilePath } = usePrReviewStore.getState()
  return { currentChapterId, currentFilePath }
}

// The first import compiles the component tree, which on a loaded machine takes longer
// than one test's 5 s; load it once here so every test times only its own work.
beforeAll(async () => {
  await import('../../src/components/pr-review/PrReviewView')
})

/** A changed file of `lines` added lines. */
function f(path: string, lines = 5) {
  return { ...mockFile, path, additions: lines, deletions: 0 }
}

function sectionPaths(): string[] {
  return screen.getAllByTestId('review-diff-pane').map((pane) => pane.dataset.path!)
}

/** 3 files, 15 changed lines: the page band. */
const smallChapters = [{ ...mockChapter, files: [f('a.ts'), f('b.ts'), f('c.ts')] }]

/** 2 chapters, 240 changed lines: the stream band. */
const mediumChapters = [
  { ...mockChapter, id: 'ch-1', name: 'Store', files: [f('store.ts', 60), f('api.ts', 60)] },
  { ...mockChapter, id: 'ch-2', name: 'View', files: [f('view.tsx', 60), f('list.tsx', 60)] },
]

/** 3 chapters, 1,500 changed lines: the chapters band. */
const largeChapters = [
  { ...mockChapter, id: 'ch-1', name: 'Store', files: [f('store.ts', 300), f('api.ts', 300)] },
  { ...mockChapter, id: 'ch-2', name: 'View', files: [f('view.tsx', 300), f('list.tsx', 300)] },
  { ...mockChapter, id: 'ch-3', name: 'Docs', files: [f('guide.md', 300)] },
]

describe('PrReviewView — a small pull request', () => {
  it('shows every file on one page, with no chapter rail or chapter headers', async () => {
    await renderView({ chapters: smallChapters })
    expect(sectionPaths()).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(screen.queryByRole('navigation', { name: 'PR chapters' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  it('says how much is read, without a chapter, in the footer', async () => {
    useReviewUiStore.setState({ fileHunks: { 'a.ts': ['@@ -1 +1 @@'], 'b.ts': [], 'c.ts': [] } })
    await renderView(
      { chapters: smallChapters },
      { viewedHunks: { 'a.ts': ['@@ -1 +1 @@'] }, currentFilePath: 'a.ts' }
    )
    expect(screen.getByText('100% read')).toBeTruthy()
  })
})

describe('PrReviewView — a medium pull request', () => {
  it('streams both chapters under sticky headers that show their read hunks', async () => {
    useReviewUiStore.setState({
      fileHunks: { 'store.ts': ['@@ -1 +1 @@', '@@ -9 +9 @@'], 'api.ts': ['@@ -3 +3 @@'] },
    })
    await renderView({ chapters: mediumChapters }, { viewedHunks: { 'store.ts': ['@@ -9 +9 @@'] } })
    expect(sectionPaths()).toEqual(['store.ts', 'api.ts', 'view.tsx', 'list.tsx'])
    expect(screen.getAllByTestId('review-diff-pane')[0].dataset.band).toBe('stream')
    const store = screen.getByRole('heading', { level: 2, name: /Store/ })
    expect(store.textContent).toContain('1 of 3 hunks read')
    expect(screen.getByRole('heading', { level: 2, name: /View/ })).toBeTruthy()
  })

  it('lists the chapters in a rail and says where the reader is in the footer', async () => {
    await renderView(
      { chapters: mediumChapters },
      { currentChapterId: 'ch-2', currentFilePath: 'view.tsx' }
    )
    const rail = screen.getByRole('navigation', { name: 'PR chapters' })
    expect(
      within(rail)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual([expect.stringContaining('Store'), expect.stringContaining('View')])
    expect(screen.getByText('Chapter 2 of 2 · 0% read')).toBeTruthy()
  })
})

describe('PrReviewView — a large pull request', () => {
  it('shows one chapter at a time', async () => {
    await renderView({ chapters: largeChapters })
    expect(sectionPaths()).toEqual(['store.ts', 'api.ts'])
  })

  it('marks every hunk of the chapter read and opens the next from Done, next chapter', async () => {
    useReviewUiStore.setState({
      fileHunks: { 'store.ts': ['@@ -1 +1 @@'], 'api.ts': ['@@ -3 +3 @@', '@@ -8 +8 @@'] },
    })
    const { user } = await renderView({ chapters: largeChapters })
    await user.click(screen.getByRole('button', { name: 'Done, next chapter' }))
    expect(usePrReviewStore.getState().viewedHunks).toEqual({
      'store.ts': ['@@ -1 +1 @@'],
      'api.ts': ['@@ -3 +3 @@', '@@ -8 +8 @@'],
    })
    expect(position()).toEqual({ currentChapterId: 'ch-2', currentFilePath: 'view.tsx' })
    expect(sectionPaths()).toEqual(['view.tsx', 'list.tsx'])
  })

  it('opens any chapter picked in the rail', async () => {
    const { user } = await renderView({ chapters: largeChapters })
    const rail = screen.getByRole('navigation', { name: 'PR chapters' })
    await user.click(within(rail).getByRole('button', { name: /Docs/ }))
    expect(sectionPaths()).toEqual(['guide.md'])
    expect(screen.getByText('Chapter 3 of 3 · 0% read')).toBeTruthy()
  })
})

describe('PrReviewView — a large pull request folds hunks', () => {
  it('lays each file out in the chapters band, so its diff folds repeated and deleted hunks', async () => {
    await renderView({ chapters: largeChapters })
    const bands = screen.getAllByTestId('review-diff-pane').map((pane) => pane.dataset.band)
    expect(bands).toEqual(['chapters', 'chapters'])
  })
})

describe('PrReviewView — mounting file sections', () => {
  it('mounts only the file sections near the viewport, keeping a placeholder for the rest', async () => {
    nearPaths = ['store.ts']
    await renderView({ chapters: mediumChapters })
    expect(sectionPaths()).toEqual(['store.ts'])
  })
})

describe('PrReviewView — the active file section', () => {
  it('lets only the section of the current file handle the review keys', async () => {
    await renderView({ chapters: mediumChapters }, { currentFilePath: 'api.ts' })
    const active = screen
      .getAllByTestId('review-diff-pane')
      .filter((p) => p.dataset.active === 'true')
    expect(active.map((p) => p.dataset.path)).toEqual(['api.ts'])
  })

  it('moves to the first file of the next chapter past the last hunk of a chapter', async () => {
    const { user } = await renderView(
      { chapters: mediumChapters },
      { currentChapterId: 'ch-1', currentFilePath: 'api.ts' }
    )
    await user.click(screen.getByRole('button', { name: 'NextFile' }))
    expect(position()).toEqual({ currentChapterId: 'ch-2', currentFilePath: 'view.tsx' })
  })

  it('moves back to the last file of the previous chapter before the first hunk', async () => {
    const { user } = await renderView(
      { chapters: mediumChapters },
      { currentChapterId: 'ch-2', currentFilePath: 'view.tsx' }
    )
    await user.click(screen.getByRole('button', { name: 'PrevFile' }))
    expect(position()).toEqual({ currentChapterId: 'ch-1', currentFilePath: 'api.ts' })
  })
})

describe('PrReviewView — later hunks', () => {
  it('opens the first later hunk after the last hunk of the PR', async () => {
    useReviewUiStore
      .getState()
      .deferHunk('/repo#1', { path: 'store.ts', header: '@@ -1,2 +1,3 @@' })
    const { user } = await renderView(
      { chapters: mediumChapters },
      { currentChapterId: 'ch-2', currentFilePath: 'list.tsx' }
    )
    await user.click(screen.getByRole('button', { name: 'NextFile' }))
    expect(position()).toEqual({ currentChapterId: 'ch-1', currentFilePath: 'store.ts' })
    expect(useReviewUiStore.getState().revisitHunk).toEqual({
      path: 'store.ts',
      header: '@@ -1,2 +1,3 @@',
    })
  })
})

describe('PrReviewView — only my files', () => {
  const twoFiles = [{ ...mockChapter, files: [f('src/mine.ts'), f('src/theirs.ts')] }]

  it('offers no Only my files toggle when the viewer owns no changed file', async () => {
    await renderView({ chapters: twoFiles, ownedPaths: [] })
    expect(screen.queryByRole('button', { name: 'Only my files' })).toBeNull()
  })

  it('shows only the owned files while the toggle is pressed', async () => {
    const { user } = await renderView({ chapters: twoFiles, ownedPaths: ['src/mine.ts'] })
    const toggle = screen.getByRole('button', { name: 'Only my files' })
    await user.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(sectionPaths()).toEqual(['src/mine.ts'])
  })

  it('puts the toggle at the top of the chapter rail in a medium pull request', async () => {
    await renderView({ chapters: mediumChapters, ownedPaths: ['store.ts'] })
    const rail = screen.getByRole('complementary', { name: 'Chapters' })
    expect(within(rail).getByRole('button', { name: 'Only my files' })).toBeTruthy()
  })
})

describe('PrReviewView — verdict bar', () => {
  it('shows the verdict bar and no Submit review button or dialog', async () => {
    await renderView()
    expect(screen.getByRole('region', { name: 'Review verdict' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Submit review/ })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('blocks Approve when the viewer wrote the pull request', async () => {
    await renderView({}, { currentUserLogin: 'alice' })
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true)
  })

  it('moves focus to the review summary on Cmd+Enter', async () => {
    const { user } = await renderView()
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(screen.getByRole('textbox', { name: 'Review summary' }).matches(':focus')).toBe(true)
  })
})

describe('PrReviewView — resuming with drafts', () => {
  it('moves focus to the review summary from Review drafts', async () => {
    const draft = {
      id: 'd1',
      path: 'src/foo.ts',
      line: 3,
      startLine: null,
      side: 'RIGHT' as const,
      body: 'Rename this.',
      fromFindingId: null,
    }
    const { user } = await renderView(
      {},
      { currentFilePath: 'src/foo.ts', lastAccessedAt: '2025-01-01T00:00:00Z', drafts: [draft] }
    )
    await user.click(screen.getByRole('button', { name: 'Review drafts' }))
    expect(screen.getByRole('textbox', { name: 'Review summary' }).matches(':focus')).toBe(true)
  })
})

describe('PrReviewView — header actions', () => {
  it('records the pause time and closes the review when Pause review is picked', async () => {
    const { user } = await renderView()
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Pause review' }))
    expect(usePrReviewStore.getState().pausedAt).not.toBeNull()
    expect(mockClose).toHaveBeenCalled()
  })

  it('calls onRefresh when Refresh pull request is picked', async () => {
    const { user } = await renderView()
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Refresh pull request' }))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('opens the inspector from Ask agent, and closes it', async () => {
    const { user } = await renderView()
    await user.click(screen.getByRole('button', { name: 'Ask agent about this PR' }))
    expect(screen.getByTestId('agent-panel')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(screen.queryByTestId('agent-panel')).toBeNull()
  })
})

describe('PrReviewView — progress in the header', () => {
  it('counts only displayed files when viewedFiles holds paths outside the PR', async () => {
    await renderView({}, { viewedFiles: new Set(['src/foo.ts', 'src/other.ts', 'src/another.ts']) })
    const segments = screen.getByRole('progressbar', { name: 'Files viewed' })
    const [segment] = within(segments).getAllByTestId('progress-segment')
    expect(segment.style.getPropertyValue('--filled')).toBe('100%')
  })
})

describe('PrReviewView — empty and after a push', () => {
  it('says there is nothing to review when the PR has no files', async () => {
    await renderView({ chapters: [] })
    expect(screen.getByText('No changed files to review.')).toBeTruthy()
  })

  it('says how many commits came since the reviewer last looked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={mockPr}
        onClose={mockClose}
        onRefresh={mockRefresh}
        sinceInfo={{ commitCount: 1, changedCount: 1, historyRewritten: false }}
      />
    )
    expect(screen.getByText('1 commit since you last looked')).toBeTruthy()
  })
})
